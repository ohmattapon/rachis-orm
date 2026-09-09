import { expect, test } from "bun:test";
import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../../src/schema";
import { query } from "../../src/builder";
import { execute } from "../../src/executor";
import { toDb, transaction } from "../../src/adapter";

// Live transaction proof: commit persists, throw rolls back.
// Skips without DATABASE_URL.
const dbUrl = process.env.DATABASE_URL ?? "";
const run = dbUrl ? test : test.skip;

const todos = defineTable(
  "tx_todos",
  z.object({ id: z.number(), title: z.string() }),
);

run("commit persists everything inside", async () => {
  const sql = new SQL(dbUrl);
  const db = toDb(sql);
  try {
    await sql`drop table if exists tx_todos`;
    await sql`create table tx_todos (id serial primary key, title text)`;
    await transaction(sql, async (tx) => {
      await execute(tx, query(todos).insert({ title: "one" }).toSQL());
      await execute(tx, query(todos).insert({ title: "two" }).toSQL());
    });
    const rows = await execute<{ title: string }>(db, query(todos).select("title").toSQL());
    expect(rows.map((r) => r.title).sort()).toEqual(["one", "two"]);
  } finally {
    await sql`drop table if exists tx_todos`;
  }
});

run("throw inside rolls everything back", async () => {
  const sql = new SQL(dbUrl);
  const db = toDb(sql);
  try {
    await sql`drop table if exists tx_todos`;
    await sql`create table tx_todos (id serial primary key, title text)`;
    await expect(
      transaction(sql, async (tx) => {
        await execute(tx, query(todos).insert({ title: "ghost" }).toSQL());
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await execute<{ title: string }>(db, query(todos).select("title").toSQL());
    expect(rows.length).toBe(0);
  } finally {
    await sql`drop table if exists tx_todos`;
  }
});
