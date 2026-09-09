import { expect, test } from "bun:test";
import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../../src/schema";
import { query } from "../../src/builder";
import { execute } from "../../src/executor";
import { toDb } from "../../src/adapter";

const dbUrl = process.env.DATABASE_URL ?? "";
const run = dbUrl ? test : test.skip;

const users = defineTable("users", z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string() }));

run("crud smoke via real PG", async () => {
  const sql = new SQL(dbUrl);
  await sql`drop table if exists users`;
  await sql`create table users (id serial primary key, first_name text, age int, status text)`;
  const ins = query(users).insert({ firstName: "A", age: 20, status: "active" }).toSQL();
  const rows = await execute<{ id: number }>(toDb(sql), ins);
  expect(rows.length).toBe(1);
  await sql`drop table users`;
});
