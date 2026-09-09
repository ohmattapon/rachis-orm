import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import type { Where } from "../src/builder";

// Property tests: thousands of generated inputs must preserve SQL-shape
// invariants. No DB needed. Deterministic seed keeps failures reproducible.
const users = defineTable(
  "users",
  z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string() }),
);

const OPS = ["=", "!=", ">", ">=", "<", "<=", "LIKE", "NOT LIKE", "IN", "NOT IN", "BETWEEN", "IS NULL", "IS NOT NULL"] as const;
const COLS = ["id", "firstName", "age", "status"] as const;

const EVIL = [
  `' OR '1'='1`,
  `'; DROP TABLE users; --`,
  `%\' UNION SELECT 1 --`,
  "/* comment */",
  "--",
  ";",
  "$1",
  "\n",
  "日本語",
  "a".repeat(500),
];

const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rand: () => number, arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;

const randVal = (rand: () => number): unknown => {
  const r = rand();
  if (r < 0.3) return pick(rand, EVIL);
  if (r < 0.6) return Math.floor(rand() * 1000);
  return `v${Math.floor(rand() * 100)}`;
};

const randWhere = (rand: () => number): Where<(typeof users.schema)["shape"]> => {
  const col = pick(rand, COLS);
  const op = pick(rand, OPS);
  if (op === "IS NULL" || op === "IS NOT NULL") return { col, op };
  if (op === "IN" || op === "NOT IN") return { col, op, val: [randVal(rand), randVal(rand)] };
  if (op === "BETWEEN") return { col, op, val: [randVal(rand), randVal(rand)] };
  return { col, op, val: randVal(rand) };
};

const placeholdersOf = (sql: string): number[] =>
  [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));

test("2000 random queries: values never leak into SQL, placeholders exact", () => {
  const rand = mulberry32(42);
  for (let i = 0; i < 2000; i++) {
    let b = query(users).select(pick(rand, COLS), pick(rand, COLS));
    const nWhere = Math.floor(rand() * 3);
    for (let k = 0; k < nWhere; k++) b = b.where(randWhere(rand));
    if (rand() < 0.4) {
      const g: ReturnType<typeof randWhere>[] = [];
      const n = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) g.push(randWhere(rand));
      b = b.orWhere(g);
    }
    if (rand() < 0.4) b = b.orderBy(pick(rand, COLS), rand() < 0.5 ? "ASC" : "DESC");
    if (rand() < 0.3) b = b.limit(Math.floor(rand() * 50));
    if (rand() < 0.3) b = b.offset(Math.floor(rand() * 50));
    const q = b.toSQL();

    // Statement terminators, comments, and newlines are never generated.
    for (const e of [";", "--", "/*", "\n"]) {
      expect(q.sql).not.toContain(e);
    }
    // Evil literals (whole strings) never leak into the SQL text.
    // "$1" is skipped: placeholders legitimately use that shape.
    for (const e of EVIL) {
      if (e === "$1") continue;
      expect(q.sql).not.toContain(e);
    }
    // Placeholders form the exact sequence 1..n with no gaps or dupes.
    const ph = placeholdersOf(q.sql);
    const sorted = [...ph].sort((a, b2) => a - b2);
    expect(sorted).toEqual(ph.length > 0 ? Array.from({ length: ph.length }, (_, k) => k + 1) : []);
    expect(ph.length).toBe(q.params.length);
    // OR groups always parenthesized.
    if (q.sql.includes(" OR ")) {
      expect(q.sql).toMatch(/\(.*OR.*\)/);
    }
  }
});
