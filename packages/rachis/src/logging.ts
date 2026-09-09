import type { Db } from "./executor";

export interface QueryLogEntry {
  sql: string;
  params: unknown[];
  durationMs: number;
  error?: unknown;
}

// Wrap any Db (or tx) with query logging. The entry fires after the query
// settles, including failures, so slow or broken queries never go silent.
// Filter slow queries on the consumer side:
//
//   withLogging(db, (e) => {
//     if (e.durationMs > 100) slowQueryLog(e);
//   });
export function withLogging(db: Db, onQuery: (entry: QueryLogEntry) => void): Db {
  return {
    query: async (sql: string, params: unknown[]): Promise<unknown[]> => {
      const started = Date.now();
      try {
        const rows = await db.query(sql, params);
        onQuery({ sql, params, durationMs: Date.now() - started });
        return rows;
      } catch (error) {
        onQuery({ sql, params, durationMs: Date.now() - started, error });
        throw error;
      }
    },
  };
}
