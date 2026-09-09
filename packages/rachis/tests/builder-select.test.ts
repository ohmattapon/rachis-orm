import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";

const users = defineTable("users", z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string(), deletedAt: z.date().nullable() }));

test("select + BETWEEN + = + IS NULL -> sql+params + auto-map", () => {
  const q = query(users).select("id", "firstName", "age")
    .where({ col: "age", op: "BETWEEN", val: [18, 30] })
    .where({ col: "status", op: "=", val: "active" })
    .where({ col: "deletedAt", op: "IS NULL" }).toSQL();
  expect(q.sql).toBe("SELECT id, first_name, age FROM users WHERE age BETWEEN $1 AND $2 AND status = $3 AND deleted_at IS NULL");
  expect(q.params).toEqual([18, 30, "active"]);
});

test("IN + NOT IN + LIKE + NOT LIKE + comparisons + IS NOT NULL", () => {
  const q = query(users).select("id")
    .where({ col: "id", op: "IN", val: [1, 2] })
    .where({ col: "status", op: "NOT LIKE", val: "%x%" }).toSQL();
  expect(q.params).toEqual([1, 2, "%x%"]);
});

test("unknown col throws + where immutable", () => {
  const b = query(users).select("id");
  expect(() => b.select("nope" as never).toSQL()).toThrow("UnknownColumn");
  const b2 = b.where({ col: "id", op: "=", val: 1 });
  expect(b2).not.toBe(b);
});
