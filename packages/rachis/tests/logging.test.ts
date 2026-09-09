import { expect, test } from "bun:test";
import type { Db } from "../src/executor";
import { withLogging, type QueryLogEntry } from "../src/logging";

const okDb: Db = {
  query: async (sql: string, params: unknown[]) => [{ sql, n: params.length }],
};

test("logs sql, params and duration on success", async () => {
  const seen: QueryLogEntry[] = [];
  const db = withLogging(okDb, (e) => seen.push(e));
  const rows = await db.query("SELECT 1 WHERE x = $1", ["a"]);
  expect(rows).toEqual([{ sql: "SELECT 1 WHERE x = $1", n: 1 }]);
  expect(seen.length).toBe(1);
  expect(seen[0].sql).toBe("SELECT 1 WHERE x = $1");
  expect(seen[0].params).toEqual(["a"]);
  expect(typeof seen[0].durationMs).toBe("number");
  expect(seen[0].durationMs).toBeGreaterThanOrEqual(0);
  expect("error" in seen[0]).toBe(false);
});

test("logs failures too and rethrows the original error", async () => {
  const boom = new Error("boom");
  const failing: Db = {
    query: async () => {
      throw boom;
    },
  };
  const seen: QueryLogEntry[] = [];
  const db = withLogging(failing, (e) => seen.push(e));
  await expect(db.query("SELECT 1", [])).rejects.toBe(boom);
  expect(seen.length).toBe(1);
  expect(seen[0].error).toBe(boom);
});

test("slow-query filter works on the consumer side", async () => {
  const slow: QueryLogEntry[] = [];
  const db = withLogging(okDb, (e) => {
    if (e.durationMs > 10_000) slow.push(e);
  });
  await db.query("SELECT 1", []);
  expect(slow.length).toBe(0);
});
