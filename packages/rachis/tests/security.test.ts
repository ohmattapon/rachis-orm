import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import { raw } from "../src/executor";

// Adversarial suite: every classic injection shape must either be
// neutralized by parameterization or rejected at build time.
// No DB needed — we assert on { sql, params } shape + throws.

const users = defineTable(
  "users",
  z.object({ id: z.number(), title: z.string(), status: z.string() }),
);

test("tautology in value stays a param, never enters SQL", () => {
  const evil = `' OR '1'='1`;
  const q = query(users).select("id").where({ col: "title", op: "=", val: evil }).toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE title = $1");
  expect(q.params).toEqual([evil]);
  expect(q.sql).not.toContain("OR '1'");
});

test("stacked query in value stays a param", () => {
  const evil = `'; DROP TABLE users; --`;
  const q = query(users).select("id").where({ col: "title", op: "=", val: evil }).toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE title = $1");
  expect(q.params).toEqual([evil]);
});

test("UNION SELECT in LIKE value stays a param", () => {
  const evil = `%\' UNION SELECT password FROM admins --`;
  const q = query(users).select("id").where({ col: "title", op: "LIKE", val: evil }).toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE title LIKE $1");
  expect(q.params).toEqual([evil]);
});

test("injection via IN-list elements stays params", () => {
  const evil = [`1) OR (1=1`, `2; DROP TABLE users`];
  const q = query(users).select("id").where({ col: "id", op: "IN", val: evil }).toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE id IN ($1, $2)");
  expect(q.params).toEqual(evil);
});

test("identifier injection via column name is rejected by whitelist", () => {
  expect(() =>
    query(users)
      .select("id; DROP TABLE users" as never)
      .toSQL(),
  ).toThrow("UnknownColumn");
  expect(() =>
    query(users)
      .select("id")
      .where({ col: "id = 1 OR 1=1 --" as never, op: "=", val: 1 })
      .toSQL(),
  ).toThrow("UnknownColumn");
});

test("prototype-pollution-ish keys rejected by whitelist", () => {
  // JSON-parsed attacker bodies DO carry __proto__ as an own key
  // (object literals don't — they set the prototype instead).
  const evilInsert = JSON.parse('{"__proto__":"x","title":"a","status":"b"}') as never;
  expect(() => query(users).insert(evilInsert).toSQL()).toThrow("UnknownColumn");
  const evilPatch = JSON.parse('{"constructor":"x"}') as never;
  expect(() =>
    query(users).update(evilPatch).where({ col: "id", op: "=", val: 1 }).toSQL(),
  ).toThrow("UnknownColumn");
});

test("raw hatch rejects ; -- /* and param mismatch", () => {
  expect(() => raw(users, "id = $1; DROP TABLE users", [1]).toSQL()).toThrow("UnsafeRaw");
  expect(() => raw(users, "id = $1 -- comment", [1]).toSQL()).toThrow("UnsafeRaw");
  expect(() => raw(users, "id = $1 /* comment", [1]).toSQL()).toThrow("UnsafeRaw");
  expect(() => raw(users, "id = $1 AND status = $2", [1]).toSQL()).toThrow("UnsafeRaw");
  expect(() => raw(users, "status = 'active'", []).toSQL()).toThrow("UnsafeRaw");
});

test("malicious operator string is rejected at build time", () => {
  expect(() =>
    query(users).select("id").where({ col: "status", op: "= 1 OR 1=1 --" as never, val: "x" }).toSQL(),
  ).toThrow("UnknownOperator");
  expect(() =>
    query(users).update({ status: "x" }).where({ col: "id", op: "!=" as never, val: 1 }).toSQL(),
  ).not.toThrow();
});

test("full-table update/delete without where is blocked", () => {
  expect(() => query(users).update({ status: "x" }).toSQL()).toThrow("UnsafeFullTable");
  expect(() => query(users).delete().toSQL()).toThrow("UnsafeFullTable");
});
