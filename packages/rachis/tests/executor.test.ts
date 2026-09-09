import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import { execute, raw } from "../src/executor";

const users = defineTable("users", z.object({ id: z.number(), age: z.number() }));

test("execute passes sql+params to Db (mock)", async () => {
  const calls: unknown[] = [];
  const fakeDb = { query: async (sql: string, params: unknown[]) => { calls.push([sql, params]); return [{ id: 1 }]; } };
  const q = query(users).select("id").where({ col: "id", op: "=", val: 1 }).toSQL();
  const rows = await execute(fakeDb, q);
  expect(calls[0]).toEqual([q.sql, q.params]);
  expect(rows).toEqual([{ id: 1 }]);
});

test("raw requires params + rejects ; -- /* + uses snake names", () => {
  const q = raw(users, "age > $1 AND deleted_at IS NULL", [20]).toSQL();
  expect(q.params).toEqual([20]);
  expect(() => raw(users, "age > 20", []).toSQL()).toThrow();
  expect(() => raw(users, "age > $1; DROP TABLE users", [1]).toSQL()).toThrow("UnsafeRaw");
  expect(() => raw(users, "age > $1 -- x", [1]).toSQL()).toThrow("UnsafeRaw");
});
