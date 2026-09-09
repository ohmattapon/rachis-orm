import { SQL } from "bun";
import { z } from "zod";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { eq, and, like } from "drizzle-orm";
import { bench, group, run } from "mitata";
import { defineTable } from "../packages/rachis/src/schema";
import { query } from "../packages/rachis/src/builder";
import { execute } from "../packages/rachis/src/executor";
import { toDb } from "../packages/rachis/src/adapter";

// Bench: Rachis vs Drizzle vs raw Bun.sql. Run with:
//   DATABASE_URL="<pg url>" bun bench/bench.ts
// NOTE: round-trip numbers include network latency — compare relatively,
// not absolutely. Builder-only group (A) has no network noise.

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("Set DATABASE_URL first");

// postgres-js (drizzle driver) chokes on channel_binding param — strip it.
const pgUrl = dbUrl.replace("&channel_binding=require", "").replace("?channel_binding=require", "");

// ---- shared table ----
const sql = new SQL(dbUrl);
const rdb = toDb(sql);
await sql`drop table if exists bench_todos`;
await sql`create table bench_todos (id serial primary key, title text not null, status text not null)`;
await sql`insert into bench_todos (title, status) select 'todo number ' || g, case when g % 2 = 0 then 'active' else 'done' end from generate_series(1, 1000) g`;

// ---- Rachis table def ----
const todoSchema = z.object({ id: z.number(), title: z.string(), status: z.string() });
const todos = defineTable("bench_todos", todoSchema);

// ---- Drizzle setup ----
const benchTodos = pgTable("bench_todos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
});
const client = postgres(pgUrl, { ssl: "require", max: 1 });
const ddb = drizzle(client);

let sink = 0;

group("A: builder-only, select + 2 wheres (no DB)", () => {
  bench("rachis toSQL", () => {
    const q = query(todos)
      .select("id", "title")
      .where({ col: "status", op: "=", val: "active" })
      .where({ col: "title", op: "LIKE", val: "%1%" })
      .toSQL();
    sink += q.sql.length + q.params.length;
  });
  bench("drizzle toSQL", () => {
    const q = ddb
      .select({ id: benchTodos.id, title: benchTodos.title })
      .from(benchTodos)
      .where(and(eq(benchTodos.status, "active"), like(benchTodos.title, "%1%")))
      .toSQL();
    sink += q.sql.length + q.params.length;
  });
});

group("B1: round-trip select by pk", () => {
  bench("rachis", async () => {
    const rows = await execute(
      rdb,
      query(todos).select("id", "title").where({ col: "id", op: "=", val: 42 }).toSQL(),
    );
    sink += rows.length;
  });
  bench("drizzle", async () => {
    const rows = await ddb
      .select({ id: benchTodos.id, title: benchTodos.title })
      .from(benchTodos)
      .where(eq(benchTodos.id, 42));
    sink += rows.length;
  });
  bench("raw bun.sql", async () => {
    const rows = await sql`select id, title from bench_todos where id = 42`;
    sink += rows.length;
  });
});

group("B2: round-trip filtered select (status + LIKE)", () => {
  bench("rachis", async () => {
    const rows = await execute(
      rdb,
      query(todos)
        .select("id", "title")
        .where({ col: "status", op: "=", val: "active" })
        .where({ col: "title", op: "LIKE", val: "%1%" })
        .toSQL(),
    );
    sink += rows.length;
  });
  bench("drizzle", async () => {
    const rows = await ddb
      .select({ id: benchTodos.id, title: benchTodos.title })
      .from(benchTodos)
      .where(and(eq(benchTodos.status, "active"), like(benchTodos.title, "%1%")));
    sink += rows.length;
  });
  bench("raw bun.sql", async () => {
    const rows = await sql`select id, title from bench_todos where status = 'active' and title like '%1%'`;
    sink += rows.length;
  });
});

group("B3: round-trip insert + returning", () => {
  bench("rachis", async () => {
    const rows = await execute(
      rdb,
      query(todos).insert({ title: "bench", status: "active" }).toSQL(),
    );
    sink += rows.length;
  });
  bench("drizzle", async () => {
    const rows = await ddb.insert(benchTodos).values({ title: "bench", status: "active" }).returning();
    sink += rows.length;
  });
  bench("raw bun.sql", async () => {
    const rows = await sql`insert into bench_todos (title, status) values ('bench', 'active') returning *`;
    sink += rows.length;
  });
});

await run();
console.log("sink:", sink);
await client.end();
