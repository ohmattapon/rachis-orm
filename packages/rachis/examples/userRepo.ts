import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import { execute, type Db } from "../src/executor";
import { toDb } from "../src/adapter";

export { toDb };

const userSchema = z.object({
  id: z.number(),
  firstName: z.string(),
  age: z.number(),
  status: z.string(),
});

export const users = defineTable("users", userSchema);

export type User = z.infer<typeof userSchema>;

// Tiny adapter lives in src/adapter.ts (re-exported above for compat).

export const userRepo = {
  findActiveAdults: (db: Db) =>
    execute<User>(
      db,
      query(users)
        .select("id", "firstName")
        .where({ col: "age", op: "BETWEEN", val: [18, 30] })
        .where({ col: "status", op: "=", val: "active" })
        .toSQL(),
    ),
  deactivate: (db: Db, id: number) =>
    execute(db, query(users).update({ status: "inactive" }).where({ col: "id", op: "=", val: id }).toSQL()),
};
