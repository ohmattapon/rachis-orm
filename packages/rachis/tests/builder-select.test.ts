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

test("orWhere groups parenthesize with continued params", () => {
  const q = query(users)
    .select("id")
    .where({ col: "status", op: "=", val: "active" })
    .orWhere([
      { col: "age", op: "<", val: 18 },
      { col: "age", op: ">", val: 60 },
    ])
    .toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE status = $1 AND (age < $2 OR age > $3)");
  expect(q.params).toEqual(["active", 18, 60]);
});

test("multiple orWhere groups AND together, or-only works, empty throws", () => {
  const q = query(users)
    .select("id")
    .orWhere([{ col: "status", op: "=", val: "a" }])
    .orWhere([
      { col: "id", op: "=", val: 1 },
      { col: "id", op: "=", val: 2 },
    ])
    .toSQL();
  expect(q.sql).toBe("SELECT id FROM users WHERE (status = $1) AND (id = $2 OR id = $3)");
  const b = query(users).select("id");
  expect(() => b.orWhere([])).toThrow();
  const b2 = b.orWhere([{ col: "id", op: "=", val: 1 }]);
  expect(b2).not.toBe(b);
});

test("orWhere on update shares numbering after SET", () => {
  const q = query(users)
    .update({ status: "x" })
    .orWhere([
      { col: "id", op: "=", val: 1 },
      { col: "id", op: "=", val: 2 },
    ])
    .toSQL();
  expect(q.sql).toBe("UPDATE users SET status = $1 WHERE (id = $2 OR id = $3) RETURNING *");
  expect(q.params).toEqual(["x", 1, 2]);
});

test("empty IN/NOT IN throws instead of emitting IN ()", () => {
  const b = query(users).select("id");
  expect(() => b.where({ col: "id", op: "IN", val: [] }).toSQL()).toThrow();
  expect(() => b.where({ col: "id", op: "NOT IN", val: [] }).toSQL()).toThrow();
});

test("select() calls append, wide operators render exact SQL", () => {
  const q = query(users)
    .select("id")
    .select("firstName")
    .where({ col: "id", op: "!=", val: 1 })
    .where({ col: "age", op: ">=", val: 18 })
    .where({ col: "status", op: "NOT LIKE", val: "%x%" })
    .where({ col: "id", op: "NOT IN", val: [2, 3] })
    .where({ col: "deletedAt", op: "IS NOT NULL" })
    .toSQL();
  expect(q.sql).toBe(
    "SELECT id, first_name FROM users WHERE id != $1 AND age >= $2 AND status NOT LIKE $3 AND id NOT IN ($4, $5) AND deleted_at IS NOT NULL",
  );
  expect(q.params).toEqual([1, 18, "%x%", 2, 3]);
});

const posts = defineTable(
  "posts",
  z.object({ id: z.number(), userId: z.number(), title: z.string() }),
);

test("LEFT JOIN qualifies cols, aliases joined selects, numbers params", () => {
  const q = query(users)
    .select("id", "firstName")
    .join(posts, { type: "LEFT", on: [{ left: "id", right: "userId" }], select: ["title"] })
    .where({ col: "status", op: "=", val: "active" })
    .toSQL();
  expect(q.sql).toBe(
    "SELECT users.id, users.first_name, posts.title AS posts_title FROM users LEFT JOIN posts ON users.id = posts.user_id WHERE status = $1",
  );
  expect(q.params).toEqual(["active"]);
});

test("INNER JOIN with multi-condition ON, default base star, second join", () => {
  const q = query(users)
    .join(posts, {
      type: "INNER",
      on: [
        { left: "id", right: "userId" },
        { left: "status", right: "title" },
      ],
      select: [],
    })
    .toSQL();
  expect(q.sql).toBe(
    "SELECT users.* FROM users INNER JOIN posts ON users.id = posts.user_id AND users.status = posts.title",
  );
});

test("join rejects bad type, empty ON, unknown cols, and is immutable", () => {
  const b = query(users).select("id");
  expect(() => b.join(posts, { type: "FULL" as never, on: [{ left: "id", right: "userId" }], select: [] })).toThrow(
    "UnknownOperator",
  );
  expect(() => b.join(posts, { type: "LEFT", on: [], select: [] })).toThrow();
  expect(() =>
    b.join(posts, { type: "LEFT", on: [{ left: "id", right: "nope" as never }], select: [] }).toSQL(),
  ).toThrow("UnknownColumn");
  expect(() =>
    b.join(posts, { type: "LEFT", on: [{ left: "id", right: "userId" }], select: ["nope" as never] }).toSQL(),
  ).toThrow("UnknownColumn");
  const b2 = b.join(posts, { type: "LEFT", on: [{ left: "id", right: "userId" }], select: ["title"] });
  expect(b2).not.toBe(b);
  expect(b.toSQL().sql).toBe("SELECT id FROM users");
});
