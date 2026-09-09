# rachis-orm

A small TypeScript ORM for Bun + PostgreSQL. No decorators, no codegen, no magic.

Full docs, usage guide, and benchmarks live in the repo:
[github.com/ohmattapon/rachis-orm](https://github.com/ohmattapon/rachis-orm)

```ts
import { SQL } from "bun";
import { defineTable, query, execute, toDb } from "rachis-orm";

const users = defineTable("users", userSchema);
const db = toDb(new SQL(process.env.DATABASE_URL ?? ""));
const rows = await execute(db, query(users).select("id").toSQL());
```

Needs Bun 1.4+ (or Node with `pg`), PostgreSQL, and `zod@^3` (installed automatically).

License: MIT.
