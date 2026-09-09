import { expect, test } from "bun:test";
import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../../src/schema";
import { query } from "../../src/builder";
import { execute, raw } from "../../src/executor";
import { toDb } from "../../src/adapter";

// Live adversarial run: fire real injection strings at Neon and prove
// (a) they match nothing, (b) the table survives. Skips without DATABASE_URL.
const dbUrl = process.env.DATABASE_URL ?? "";
const run = dbUrl ? test : test.skip;

const users = defineTable(
  "users",
  z.object({ id: z.number(), title: z.string(), status: z.string() }),
);

run("injection strings match nothing and table survives", async () => {
  const sql = new SQL(dbUrl);
  const db = toDb(sql);
  try {
    await sql`drop table if exists users`;
    await sql`create table users (id serial primary key, title text, status text)`;
    await execute(
      db,
      query(users).insert({ title: "hello", status: "active" }).toSQL(),
    );
    await execute(
      db,
      query(users).insert({ title: "world", status: "done" }).toSQL(),
    );

    // Tautology / stacked / union attempts must return 0 rows, not all rows.
    for (const evil of [`' OR '1'='1`, `'; DROP TABLE users; --`, `%\' UNION SELECT 1 --`]) {
      const rows = await execute(
        db,
        query(users).select("id").where({ col: "title", op: "=", val: evil }).toSQL(),
      );
      expect(rows.length).toBe(0);
    }

    // Raw-hatch abuse must throw before anything is sent.
    expect(() => raw(users, "1=1; DROP TABLE users", []).toSQL()).toThrow("UnsafeRaw");

    // Table intact with exactly the 2 seeded rows.
    const count = (await sql`select count(*)::int as n from users`) as { n: number }[];
    expect(count[0].n).toBe(2);
  } finally {
    await sql`drop table if exists users`;
  }
});
