# Usage

Everything needed to use Rachis day to day: setup, queries, safety rules,
repositories, migrations, and tests.

## Getting started

### 1. Requirements

- Bun 1.4 or newer
- PostgreSQL
- `zod@^3`

### 2. Define tables

Keys stay camelCase on the code side. Rachis maps them to snake_case columns.
Names the mapping gets wrong, like `userID`, take a per-field override.

```ts
import { z } from "zod";
import { defineTable } from "@internal/rachis";

const userSchema = z.object({
  id: z.number(),
  firstName: z.string(),
  age: z.number(),
  status: z.string(),
});
const users = defineTable("users", userSchema);
type User = z.infer<typeof userSchema>;
```

### 3. Build queries, then run them

Building and running stay separate. Calling `.where()` more than once means AND.

```ts
import { SQL } from "bun";
import { query, execute, toDb } from "@internal/rachis";

const db = toDb(new SQL(process.env.DATABASE_URL ?? ""));

const q = query(users)
  .select("id", "firstName")
  .where({ col: "age", op: "BETWEEN", val: [18, 30] })
  .where({ col: "status", op: "=", val: "active" })
  .toSQL();
// q.sql    -> "SELECT id, first_name, age FROM users WHERE age BETWEEN $1 AND $2 AND status = $3"
// q.params -> [18, 30, "active"]

const rows = await execute<User>(db, q);
```

```ts
await execute(db, query(users).insert({ firstName: "A", age: 20, status: "active" }).toSQL());

await execute(db,
  query(users).update({ status: "inactive" }).where({ col: "id", op: "=", val: 1 }).toSQL());

await execute(db,
  query(users).delete().where({ col: "id", op: "=", val: 1 }).toSQL());
```

`insert` and `update` return the affected rows through `RETURNING *`.

## Ordering and pagination

`.orderBy()` accumulates and defaults to ascending. `.limit()` and `.offset()`
take non-negative integers and travel as params like everything else.

```ts
const page2 = await execute<User>(
  db,
  query(users)
    .select("id", "firstName")
    .where({ col: "status", op: "=", val: "active" })
    .orderBy("age", "DESC")
    .limit(20)
    .offset(20)
    .toSQL(),
);
```

Sort columns pass the same whitelist as everything else. Bad directions throw
at call time, bad counts throw at call time.

## Transactions

Wrap several queries in one transaction with `transaction()`. Returning commits,
throwing rolls everything back. Repositories take the `tx` object exactly like
a normal `db`.

```ts
import { transaction } from "@internal/rachis";

await transaction(sql, async (tx) => {
  await userRepo.deactivate(tx, 1);
  await userRepo.deactivate(tx, 2);
});
```

## Safety rules

An `update` or `delete` without `where` throws at once. No bypass exists in v1.

```ts
query(users).update({ status: "x" }).toSQL(); // UnsafeFullTableError
```

A column missing from the schema cannot be used. It throws `UnknownColumnError`
while building, before anything reaches the database. Every value travels as a
param, so a string like `' OR '1'='1` stays an ordinary comparison value.

`raw()` covers what the builder cannot express, such as OR conditions. It takes
DB-side names, requires params every time, rejects `;` `--` `/*`, and checks
the param count against `$n`.

```ts
import { raw } from "@internal/rachis";

const q = raw(users, "status = $1 OR (age BETWEEN $2 AND $3)", ["done", 18, 28]).toSQL();
await execute(db, q);
```

## Repository pattern

Rachis knows nothing about use cases. Each domain wraps queries in its own
methods.

```ts
export const userRepo = {
  findActiveAdults: (db: Db) =>
    execute<User>(db,
      query(users).select("id", "firstName")
        .where({ col: "age", op: "BETWEEN", val: [18, 30] })
        .where({ col: "status", op: "=", val: "active" }).toSQL()),
  deactivate: (db: Db, id: number) =>
    execute(db,
      query(users).update({ status: "inactive" }).where({ col: "id", op: "=", val: id }).toSQL()),
};
```

## Migrations

There is no migration engine in v1. Write SQL files, store them by timestamp,
apply in order. Applied files get recorded in `rachis_migrations`, so re-runs
skip what is done.

```bash
bun run db:new add-users   # scaffold timestamped up/down files
bun run db:generate <tables-file>  # emit CREATE TABLE migration from Zod schemas
bun run db:push <tables-file>      # apply schema straight to the DB, no files
bun run db:status          # show applied vs pending
bun run db:migrate         # apply pending files in order
```

`generate` maps `id: number` to `SERIAL PRIMARY KEY`, other numbers to
`INTEGER`, strings to `TEXT`, booleans to `BOOLEAN`, dates to `TIMESTAMPTZ`.
Optional and nullable fields stay nullable, the rest is `NOT NULL`. A Zod
`.default()` with a static string, number, or boolean becomes a database
`DEFAULT` (function defaults are evaluated once at generate time). Anything
dynamic, like `() => new Date()`, throws instead of freezing a wrong value,
so write that default into the file by hand. Anything else throws instead
of guessing.

## Tests

```bash
bun test packages/rachis/tests/
bunx tsc --noEmit -p packages/rachis/tsconfig.json
```

Unit tests check SQL plus params with no database. Integration tests need a
real one. `tests/security.test.ts` fires classic injection shapes at the
builder and the raw hatch and asserts nothing gets through.

```bash
DATABASE_URL="<url>" bun test packages/rachis/tests/integration/
```

`packages/rachis/examples/todo-api.ts` runs a full API in one file:
`POST /todos`, `GET /todos?status=active&q=foo`, `PATCH /todos/:id`,
`DELETE /todos/:id`, plus `GET /guard-demo` showing a whereless update getting
blocked.

## Observability

Wrap any `Db` (or transaction handle) with `withLogging()` to record every
query with its SQL, params, and duration. Entries fire on failures too, so
broken queries never go silent. Slow-query detection stays on your side.

```ts
import { withLogging } from "@internal/rachis";

const db = withLogging(toDb(sql), (entry) => {
  if (entry.durationMs > 100) console.warn("slow query", entry);
  if (entry.error) console.error("failed query", entry);
});
```

Rachis sets no timeouts itself. Cap runaway queries at the connection level
instead, either in the URL or on the role.

```bash
DATABASE_URL="postgres://user:pass@host/db?sslmode=require&options=-c%20statement_timeout%3D5s"
```

```sql
ALTER ROLE app LOGIN;
ALTER DATABASE appdb SET statement_timeout = '5s';
```
