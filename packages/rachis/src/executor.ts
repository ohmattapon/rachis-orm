import type { z } from "zod";
import type { BuiltQuery } from "./builder.ts";
import { UnsafeRawError } from "./errors.ts";
import type { TableDef } from "./schema.ts";

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
  const seen = new Set<number>();
  for (const m of sqlFragment.matchAll(/\$(\d+)/g)) {
    const n = Number(m[1]);
    seen.add(n);
    if (n > max) max = n;
  }
  if (params.length === 0 || params.length !== max) {
    throw new UnsafeRawError(`UnsafeRaw: params length ${params.length} does not match $n max ${max}`);
  }
  for (let i = 1; i <= max; i++) {
    if (!seen.has(i)) {
      throw new UnsafeRawError(`UnsafeRaw: placeholder $${i} is missing from the fragment`);
    }
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
