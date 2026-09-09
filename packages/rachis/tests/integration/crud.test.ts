import { expect, test } from "bun:test";
import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../../src/schema";
import { query } from "../../src/builder";
import { execute } from "../../src/executor";

const dbUrl = process.env.DATABASE_URL ?? "";
const run = dbUrl ? test : test.skip;

const users = defineTable("users", z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string() }));

run("crud smoke via real PG", async () => {
  const db = new SQL(dbUrl);
  await db`drop table if exists users`;
  await db`create table users (id serial primary key, first_name text, age int, status text)`;
  const ins = query(users).insert({ firstName: "A", age: 20, status: "active" }).toSQL();
  const rows = await execute<{ id: number }>(db as never, ins);
  expect(rows.length).toBe(1);
  await db`drop table users`;
});
