import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";

const users = defineTable("users", z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string() }));

test("insert maps + params order", () => {
  const q = query(users).insert({ firstName: "A", age: 20, status: "active" }).toSQL();
  expect(q.sql).toBe("INSERT INTO users (first_name, age, status) VALUES ($1, $2, $3) RETURNING *");
  expect(q.params).toEqual(["A", 20, "active"]);
});

test("update/delete without where throws", () => {
  expect(() => query(users).update({ status: "x" }).toSQL()).toThrow("UnsafeFullTable");
  expect(() => query(users).delete().toSQL()).toThrow("UnsafeFullTable");
});

test("update/delete with where ok", () => {
  const q = query(users).update({ status: "x" }).where({ col: "id", op: "=", val: 1 }).toSQL();
  expect(q.sql).toContain("UPDATE users SET status = $1 WHERE id = $2");
});
