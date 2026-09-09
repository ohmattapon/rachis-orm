import { expect, test } from "bun:test";
import { z } from "zod";
import { defineTable, autoMap } from "../src/schema";

test("autoMap camel->snake", () => { expect(autoMap("firstName")).toBe("first_name"); });
test("defineTable exposes tableName + whitelist", () => {
  const users = defineTable("users", z.object({ id: z.number(), firstName: z.string() }));
  expect(users.tableName).toBe("users");
  expect(() => users.assertColumn("nope")).toThrow("UnknownColumn");
});
test("override per-field wins over regex", () => {
  const t = defineTable("users", z.object({ userID: z.string() }), { columnMap: { userID: "user_id" } });
  expect(t.sqlColumn("userID")).toBe("user_id");
});
