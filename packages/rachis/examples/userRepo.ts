import { z } from "zod";
import { SQL } from "bun";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import { execute, type Db } from "../src/executor";

const userSchema = z.object({
  id: z.number(),
  firstName: z.string(),
  age: z.number(),
  status: z.string(),
});

export const users = defineTable("users", userSchema);

export type User = z.infer<typeof userSchema>;

// Tiny adapter: real Bun.sql driver -> Db interface.
// Db.query is NON-generic by design (execute<T> casts internally),
// Bun SQL instances expose .unsafe(sql, params) instead of .query.
export function toDb(sql: SQL): Db {
  return {
    query: async (text: string, params: unknown[]): Promise<unknown[]> => {
      const rows = await sql.unsafe(text, params);
      return rows as unknown[];
    },
  };
}

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
