import { z } from "zod";
import { UnknownColumnError } from "./errors";

export interface DefineTableOptions {
  columnMap?: Record<string, string>;
}

export function autoMap(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function resolveColumn(name: string, columnMap?: Record<string, string>): string {
  const override = columnMap?.[name];
  if (override !== undefined) return override;
  return autoMap(name);
}

export interface TableDef<Shape extends z.ZodRawShape> {
  tableName: string;
  schema: z.ZodObject<Shape>;
  columns: (keyof Shape & string)[];
  assertColumn(col: string): void;
  sqlColumn(col: string): string;
}

export function defineTable<Shape extends z.ZodRawShape>(
  tableName: string,
  zodSchema: z.ZodObject<Shape>,
  opts?: DefineTableOptions,
): TableDef<Shape> {
  const columns = Object.keys(zodSchema.shape) as (keyof Shape & string)[];
  const columnSet = new Set<string>(columns);

  function assertColumn(col: string): void {
    if (!columnSet.has(col)) {
      throw new UnknownColumnError(`UnknownColumn: ${col} is not a column of table ${tableName}`);
    }
  }

  function sqlColumn(col: string): string {
    assertColumn(col);
    return resolveColumn(col, opts?.columnMap);
  }

  return { tableName, schema: zodSchema, columns, assertColumn, sqlColumn };
}
