import { SQL } from "bun";
import type { Db } from "./executor";

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
