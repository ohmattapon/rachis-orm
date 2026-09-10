import type { Db } from "./executor.ts";

export interface QueryLogEntry {
  sql: string;
  params: unknown[];
  durationMs: number;
  error?: unknown;
}

export interface LoggingOptions {
  maskParams?: boolean | ((param: unknown, index: number) => unknown);
}

function processParams(params: unknown[], options?: LoggingOptions): unknown[] {
  if (!options?.maskParams) return params;
  if (typeof options.maskParams === "function") {
    return params.map(options.maskParams);
  }
  return params.map(() => "[REDACTED]");
}

// Wrap any Db (or tx) with query logging. The entry fires after the query
// settles, including failures, so slow or broken queries never go silent.
// Filter slow queries on the consumer side:
//
//   withLogging(db, (e) => {
//     if (e.durationMs > 100) slowQueryLog(e);
//   });
export function withLogging(
  db: Db,
  onQuery: (entry: QueryLogEntry) => void,
  options?: LoggingOptions,
): Db {
  return {
    query: async (sql: string, params: unknown[]): Promise<unknown[]> => {
      const started = Date.now();
      const loggedParams = processParams(params, options);
      try {
        const rows = await db.query(sql, params);
        onQuery({ sql, params: loggedParams, durationMs: Date.now() - started });
        return rows;
      } catch (error) {
        onQuery({ sql, params: loggedParams, durationMs: Date.now() - started, error });
        throw error;
      }
    },
  };
}
