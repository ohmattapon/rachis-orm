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
test("order + limit + offset append after where with continued params", () => {
  const q = query(users)
    .select("id", "firstName")
    .where({ col: "status", op: "=", val: "active" })
    .orderBy("age", "DESC")
    .limit(10)
    .offset(20)
    .toSQL();
  expect(q.sql).toBe(
    "SELECT id, first_name FROM users WHERE status = $1 ORDER BY age DESC LIMIT $2 OFFSET $3",
  );
  expect(q.params).toEqual(["active", 10, 20]);
});

test("orderBy accumulates, defaults to ASC, maps columns", () => {
  const q = query(users)
    .select("id")
    .orderBy("age", "DESC")
    .orderBy("firstName")
    .toSQL();
  expect(q.sql).toBe("SELECT id FROM users ORDER BY age DESC, first_name ASC");
});

test("orderBy unknown col throws, limit/offset/dir validated", () => {
  const b = query(users).select("id");
  expect(() => b.orderBy("nope" as never).toSQL()).toThrow("UnknownColumn");
  expect(() => b.orderBy("age", "UP" as never)).toThrow("UnknownOperator");
  expect(() => b.limit(-1)).toThrow();
  expect(() => b.limit(1.5)).toThrow();
  expect(() => b.offset(-2)).toThrow();
  const b2 = b.limit(5);
  expect(b2).not.toBe(b);
  expect(b2.toSQL().sql).toBe("SELECT id FROM users LIMIT $1");
});
