# Rachis

Rachis is a TypeScript ORM the team wrote for itself. It targets the internal
stack of TypeScript + Bun + PostgreSQL with a hexagonal layout, and replaces
outside dependencies like Prisma or TypeORM.

## Why roll our own

General purpose libraries ship more than the team uses. Decorators, code
generation, native binaries. Rachis keeps only what gets used. You can read
every line of it in a day.

Four rules shape the design.

- Small API. A few hours is enough to learn it.
- Safe. Every query is parameterized. Table and column names pass a whitelist
  built from the schema, nothing else gets through.
- Light. No decorators, no reflect-metadata, no separate codegen step,
  as few dependencies as possible.
- Explicit. No auto-join, no lazy loading working behind your back.

## Requirements

- Bun 1.4 or newer
- PostgreSQL (the only database supported right now)
- `zod@^3` for schema definitions

## How it is put together

The code has four layers and each one does a single job.

1. schema defines tables with Zod. One schema validates and infers types.
2. query builder produces a SQL string plus a parameter array. It never runs anything.
3. executor takes SQL plus params and runs them through the driver (`Bun.sql`).
4. repository wraps the builder in methods shaped by each domain use case.

```
packages/rachis/
  src/schema.ts    # defineTable, auto-map, whitelist
  src/builder.ts   # query().select().where().toSQL()
  src/executor.ts  # execute(), raw(), Db interface
  src/adapter.ts   # toDb() turns Bun.sql into a Db
  src/errors.ts
  examples/userRepo.ts  # repository example
  examples/todo-api.ts  # full API example
```

## Getting started

Define tables with camelCase keys on the code side. Rachis maps them to
snake_case columns on its own. Names the mapping gets wrong (like `userID`)
take a per-field override.

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

Build a query, then run it. The two steps stay separate.

```ts
import { SQL } from "bun";
import { query } from "@internal/rachis";
import { execute } from "@internal/rachis";
import { toDb } from "@internal/rachis";

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

Calling `.where()` more than once means AND. There is no OR in v1.

```ts
await execute(db, query(users).insert({ firstName: "A", age: 20, status: "active" }).toSQL());

await execute(db,
  query(users).update({ status: "inactive" }).where({ col: "id", op: "=", val: 1 }).toSQL());

await execute(db,
  query(users).delete().where({ col: "id", op: "=", val: 1 }).toSQL());
```

`insert` returns the added row (it carries `RETURNING *`). `update` returns no
rows, so select again yourself when you need the values after an update.

## Safety rules

An `update` or `delete` without `where` throws at once. There is no bypass in v1.

```ts
query(users).update({ status: "x" }).toSQL(); // UnsafeFullTableError
```

A column missing from the schema cannot be used. It throws `UnknownColumnError`
while building, before anything reaches the database.

```ts
query(users).select("id; DROP TABLE users").toSQL(); // UnknownColumnError
```

Every value travels as a param. A string like `' OR '1'='1` becomes an ordinary
comparison value. It never lands inside the SQL.

## The hatch for queries the builder cannot reach

`raw()` exists for the spots the builder cannot express, such as OR
conditions. It takes DB-side names, requires params every time, rejects `;`
`--` `/*`, and checks the param count against `$n`.

```ts
import { raw } from "@internal/rachis";

const q = raw(users, "status = $1 OR (age BETWEEN $2 AND $3)", ["done", 18, 28]).toSQL();
await execute(db, q);
```

## Repository

Rachis knows nothing about use cases. Wrap queries in methods that follow the
domain, one per job.

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

v1 has no migration engine. Write the SQL yourself, store it by timestamp,
and apply it in order.

```
migrations/20260909000000_init.up.sql
migrations/20260909000000_init.down.sql
```

```bash
DATABASE_URL="<url>" bun scripts/migrate.ts
```

## Tests

```bash
bun test packages/rachis/tests/
bunx tsc --noEmit -p packages/rachis/tsconfig.json
```

Tests come in two kinds. Unit tests check the SQL string plus params with no
database. Integration tests need a real one.

```bash
DATABASE_URL="<url>" bun test packages/rachis/tests/integration/
```

The `tests/` folder also holds an attack suite (`security.test.ts`) that fires
the classic injection shapes at the builder and the raw hatch and asserts
nothing gets through. All of it stays green before a merge.

## Example API

`packages/rachis/examples/todo-api.ts` is a complete API in one file. Run it
directly.

```bash
DATABASE_URL="<url>" bun packages/rachis/examples/todo-api.ts
```

It serves `POST /todos`, `GET /todos?status=active&q=foo`, `PATCH /todos/:id`,
`DELETE /todos/:id`. `GET /guard-demo` shows how an update without where gets
blocked.

## Benchmark

`bench/bench.ts` uses mitata to compare Rachis against Drizzle and raw
`Bun.sql`. One command runs it.

```bash
DATABASE_URL="<url>" bun bench/bench.ts
```

Numbers measured once on a Ryzen 5 through a Neon pooler: the builder alone
does 646 ns per call for Rachis against 11.5 µs for Drizzle. Round trips sit
next to raw (around 37 ms) while Drizzle sat near 74 ms. Round-trip figures
include network latency, so read them as relative only. That Drizzle run also
used the `postgres-js` driver while Rachis used `Bun.sql`, a different driver
on each side.

## v1 limits

- `where` does AND only
- No relations, no joins
- No `limit` `offset` `orderBy` (use `raw()` for now)
- `update` returns no rows
- An empty `IN ()` produces unusable SQL. The team knows and plans to fix it
  next round
- Bun first. Node needs its own adapter wrapping `pg` or `postgres-js` into a
  `Db`, about ten lines
