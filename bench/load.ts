import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../packages/rachis/src/schema";
import { query } from "../packages/rachis/src/builder";
import { execute } from "../packages/rachis/src/executor";
import { toDb } from "../packages/rachis/src/adapter";

// Load + soak: concurrent mixed reads through Rachis, watching throughput,
// tail latency drift, and errors across rounds with fresh clients.
//   DATABASE_URL="<url>" bun bench/load.ts
// Kept small on purpose: this hammers a real database.

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("Set DATABASE_URL first");

const CONCURRENCY = 20;
const QUERIES_PER_ROUND = 500;
const ROUNDS = 5;

const todos = defineTable("load_t", z.object({ id: z.number(), title: z.string(), status: z.string() }));

const setup = new SQL(dbUrl);
await setup`drop table if exists load_t`;
await setup`create table load_t (id serial primary key, title text, status text)`;
await setup`insert into load_t (title, status) select 't' || g, case when g % 2 = 0 then 'active' else 'done' end from generate_series(1, 1000) g`;
await setup.close();

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const worker = async (db: ReturnType<typeof toDb>, n: number, lats: number[]): Promise<void> => {
  for (let i = 0; i < n; i++) {
    const id = 1 + Math.floor(Math.random() * 1000);
    const t0 = Date.now();
    if (id % 2 === 0) {
      await execute(db, query(todos).select("id", "title").where({ col: "id", op: "=", val: id }).toSQL());
    } else {
      await execute(
        db,
        query(todos)
          .select("id")
          .where({ col: "status", op: "=", val: "active" })
          .where({ col: "title", op: "LIKE", val: `%${id % 10}%` })
          .limit(10)
          .toSQL(),
      );
    }
    lats.push(Date.now() - t0);
  }
};

let totalErrors = 0;
for (let r = 1; r <= ROUNDS; r++) {
  const sql = new SQL(dbUrl);
  const db = toDb(sql);
  const lats: number[] = [];
  const perWorker = Math.floor(QUERIES_PER_ROUND / CONCURRENCY);
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, () => worker(db, perWorker, lats)),
  );
  const elapsed = (Date.now() - t0) / 1000;
  const errors = results.filter((x) => x.status === "rejected").length;
  totalErrors += errors;
  lats.sort((a, b) => a - b);
  console.log(
    `round ${r}: ${lats.length} queries in ${elapsed.toFixed(1)}s ` +
      `(${(lats.length / elapsed).toFixed(0)}/s) avg ${(lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(1)}ms ` +
      `p50 ${pct(lats, 50).toFixed(0)}ms p99 ${pct(lats, 99).toFixed(0)}ms max ${lats[lats.length - 1]}ms errors ${errors}`,
  );
  await sql.close();
}
console.log(totalErrors === 0 ? "soak ok: zero errors, clients cycled every round" : `ERRORS: ${totalErrors}`);

const cleanup = new SQL(dbUrl);
await cleanup`drop table if exists load_t`;
await cleanup.close();
console.log("playground cleaned");
