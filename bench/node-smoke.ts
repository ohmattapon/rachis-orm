import { Pool } from "pg";
import { z } from "zod";
import { defineTable } from "../packages/rachis/src/schema.ts";
import { query } from "../packages/rachis/src/builder.ts";
import { execute } from "../packages/rachis/src/executor.ts";
import { toPgPool } from "../packages/rachis/src/adapter-pg.ts";

// Node.js smoke test for rachis-orm: schema, builder, execute, count over
// node-postgres, plus setup/cleanup in pure pg. Run with node (not bun):
//   node --experimental-strip-types bench/node-smoke.ts
// Needs DATABASE_URL.
const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("Set DATABASE_URL first");

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await pool.query("drop table if exists node_smoke");
await pool.query("create table node_smoke (id serial primary key, title text, status text)");

const todos = defineTable("node_smoke", z.object({ id: z.number(), title: z.string(), status: z.string() }));
const db = toPgPool(pool);

const insRows = await execute<{ id: number }>(
  db,
  query(todos).insert({ title: "n", status: "active" }).toSQL(),
);
const ins = insRows[0] as { id: number };
const rows = await execute<{ title: string }>(
  db,
  query(todos).select("id", "title").where({ col: "status", op: "=", val: "active" }).limit(1).toSQL(),
);
const cntRows = await execute<{ count: string }>(
  db,
  query(todos).where({ col: "status", op: "=", val: "active" }).count().toSQL(),
);
console.log(`insert id=${ins.id}, select=${rows.length}, count=${cntRows[0].count}`);
if (rows.length !== 1 || Number(cntRows[0].count) !== 1) throw new Error("node smoke failed");

await pool.query("drop table if exists node_smoke");
await pool.end();
console.log("node ok");
