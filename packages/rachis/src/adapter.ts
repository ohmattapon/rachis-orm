import type { Db } from "./executor.ts";

// Minimal structural shape of a Bun.sql client. The adapter never imports
// "bun" itself, so this module loads on Node too. Anything with .unsafe()
// (and .begin() for transactions) fits, on either runtime.
export interface BunSqlClient {
  unsafe(sql: string, params: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: BunSqlClient) => Promise<T>): Promise<T>;
}

export function toDb(sql: BunSqlClient): Db {
  return {
    query: async (text: string, params: unknown[]): Promise<unknown[]> => {
      const rows = await sql.unsafe(text, params);
      return rows as unknown[];
    },
  };
}

// Run fn inside one transaction. Throwing inside fn rolls everything back,
// returning commits. Repositories take the tx Db like any other Db.
export async function transaction<T>(sql: BunSqlClient, fn: (tx: Db) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => fn(toDb(tx)));
}
