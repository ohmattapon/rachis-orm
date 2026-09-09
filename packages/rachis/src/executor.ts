import type { z } from "zod";
import type { BuiltQuery } from "./builder";
import { UnsafeRawError } from "./errors";
import type { TableDef } from "./schema";

export interface Db {
  query(sql: string, params: unknown[]): Promise<unknown[]>;
}

export async function execute<T>(db: Db, q: BuiltQuery): Promise<T[]> {
  return (await db.query(q.sql, q.params)) as T[];
}

export interface RawBuilder {
  toSQL(): BuiltQuery;
}

export function assertSafeRaw(tableName: string, sqlFragment: string, params: unknown[]): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new UnsafeRawError(`UnsafeRaw: unknown table ${tableName}`);
  }
  if (sqlFragment.includes(";") || sqlFragment.includes("--") || sqlFragment.includes("/*")) {
    throw new UnsafeRawError(`UnsafeRaw: fragment contains forbidden token`);
  }
  let max = 0;
  for (const m of sqlFragment.matchAll(/\$(\d+)/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  if (params.length === 0 || params.length !== max) {
    throw new UnsafeRawError(`UnsafeRaw: params length ${params.length} does not match $n max ${max}`);
  }
}

export function raw<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  sqlFragment: string,
  params: unknown[],
): RawBuilder {
  assertSafeRaw(table.tableName, sqlFragment, params);
  return {
    toSQL(): BuiltQuery {
      return { sql: `SELECT * FROM ${table.tableName} WHERE ${sqlFragment}`, params };
    },
  };
}
