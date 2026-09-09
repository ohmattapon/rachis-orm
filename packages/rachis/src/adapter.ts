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

// Run fn inside one transaction. Throwing inside fn rolls everything back,
// returning commits. Repositories take the tx Db like any other Db.
export async function transaction<T>(sql: SQL, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => fn(toDb(tx as SQL)));
}
