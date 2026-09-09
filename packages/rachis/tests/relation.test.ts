import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";

const posts = defineTable(
  "posts",
  z.object({ id: z.number(), userId: z.number(), title: z.string() }),
);

const users = defineTable(
  "users",
  z.object({ id: z.number(), firstName: z.string() }),
  {
    relations: {
      // one-to-many: posts.user_id -> users.id
      posts: { table: () => posts, type: "many", fk: "userId", ref: "id" },
    },
  },
);

const profiles = defineTable(
  "profiles",
  z.object({ id: z.number(), bio: z.string(), userId: z.number() }),
);

const usersWithProfile = defineTable(
  "users2",
  z.object({ id: z.number(), firstName: z.string(), profileId: z.number() }),
  {
    relations: {
      // belongs-to: users2.profile_id -> profiles.id
      profile: { table: () => profiles, type: "one", fk: "profileId", ref: "id" },
    },
  },
);

test("with() 'many' builds LEFT JOIN from declared relation", () => {
  const q = query(users).with("posts", ["title"]).toSQL();
  expect(q.sql).toBe("SELECT users.*, posts.title AS posts_title FROM users LEFT JOIN posts ON users.id = posts.user_id");
  expect(q.params).toEqual([]);
});

test("with() defaults select to all related columns", () => {
  const q = query(users).with("posts").toSQL();
  expect(q.sql).toBe(
    "SELECT users.*, posts.id AS posts_id, posts.user_id AS posts_user_id, posts.title AS posts_title FROM users LEFT JOIN posts ON users.id = posts.user_id",
  );
});

test("with() 'one' puts local FK on the left of ON", () => {
  const q = query(usersWithProfile).with("profile", ["bio"]).toSQL();
  expect(q.sql).toBe("SELECT users2.*, profiles.bio AS profiles_bio FROM users2 LEFT JOIN profiles ON users2.profile_id = profiles.id");
});

test("with() composes with select, where, orderBy, limit", () => {
  const q = query(users)
    .select("id")
    .with("posts", ["title"])
    .where({ col: "id", op: "=", val: 1 })
    .orderBy("id", "DESC")
    .limit(5)
    .toSQL();
  expect(q.sql).toBe(
    "SELECT users.id, posts.title AS posts_title FROM users LEFT JOIN posts ON users.id = posts.user_id WHERE id = $1 ORDER BY id DESC LIMIT $2",
  );
  expect(q.params).toEqual([1, 5]);
});

test("with() unknown relation fails fast", () => {
  expect(() => query(users).with("comments").toSQL()).toThrow("UnknownRelation");
});

test("with() validates related columns at toSQL()", () => {
  expect(() => query(users).with("posts", ["nope" as never]).toSQL()).toThrow("UnknownColumn");
});

test("with() is immutable", () => {
  const b = query(users).select("id");
  const b2 = b.with("posts", ["title"]);
  expect(b2).not.toBe(b);
  expect(b.toSQL().sql).toBe("SELECT id FROM users");
});

test("with() then manual join() compose", () => {
  const q = query(users).with("posts", ["title"]).join(profiles, { type: "INNER", on: [{ left: "id", right: "userId" }], select: ["bio"] }).toSQL();
  expect(q.sql).toBe(
    "SELECT users.*, posts.title AS posts_title, profiles.bio AS profiles_bio FROM users LEFT JOIN posts ON users.id = posts.user_id INNER JOIN profiles ON users.id = profiles.user_id",
  );
});
