import { expect, test } from "bun:test";
import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../../src/schema";
import { query } from "../../src/builder";
import { execute, raw } from "../../src/executor";
import { toDb } from "../../src/adapter";

// Live coverage for paths previously unit-only: BETWEEN / IN / NOT IN /
// NOT LIKE, expressive raw() (incl. OR, which the builder has no syntax
// for), against real PG. Skips without DATABASE_URL.
const dbUrl = process.env.DATABASE_URL ?? "";
const run = dbUrl ? test : test.skip;

const todos = defineTable(
  "coverage_todos",
  z.object({ id: z.number(), title: z.string(), status: z.string(), age: z.number() }),
);

const seed: [string, string, number][] = [
  ["alpha", "active", 20],
  ["beta", "active", 35],
  ["gamma", "done", 25],
  ["delta", "done", 40],
  ["epsilon", "active", 28],
];

const titles = (rows: { title: string }[]): string[] => rows.map((r) => r.title).sort();

run("BETWEEN / IN / NOT IN / NOT LIKE / expressive raw on live PG", async () => {
  const sql = new SQL(dbUrl);
  const db = toDb(sql);
  try {
    await sql`drop table if exists coverage_todos`;
    await sql`create table coverage_todos (id serial primary key, title text, status text, age int)`;
    for (const [title, status, age] of seed) {
      await execute(db, query(todos).insert({ title, status, age }).toSQL());
    }

    const between = await execute<{ title: string }>(
      db,
      query(todos)
        .select("title")
        .where({ col: "age", op: "BETWEEN", val: [18, 30] })
        .toSQL(),
    );
    expect(titles(between)).toEqual(["alpha", "epsilon", "gamma"]);

    const notIn = await execute<{ title: string }>(
      db,
      query(todos)
        .select("title")
        .where({ col: "status", op: "NOT IN", val: ["active"] })
        .toSQL(),
    );
    expect(titles(notIn)).toEqual(["delta", "gamma"]);

    const notLike = await execute<{ title: string }>(
      db,
      query(todos)
        .select("title")
        .where({ col: "title", op: "NOT LIKE", val: "%a%" })
        .toSQL(),
    );
    expect(titles(notLike)).toEqual(["epsilon"]);

    // The escape hatch earning its keep: OR has no builder syntax in v1.
    const viaRaw = await execute<{ title: string }>(
      db,
      raw(todos, "status = $1 OR (age BETWEEN $2 AND $3)", ["done", 18, 28]).toSQL(),
    );
    expect(titles(viaRaw)).toEqual(["alpha", "delta", "epsilon", "gamma"]);
  } finally {
    await sql`drop table if exists coverage_todos`;
  }
});
