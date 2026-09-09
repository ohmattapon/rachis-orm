import { z } from "zod";
import { UnknownColumnError, UnknownRelationError } from "./errors.ts";

export interface DefineTableOptions {
  columnMap?: Record<string, string>;
  // Declared relations, resolved lazily so circular table definitions work.
  // "many": one-to-many — the RELATED table holds the FK; `fk` names that column on the related table.
  // "one": belongs-to — THIS table holds the FK; `fk` names the local column.
  // `ref` names the referenced column on the pointed-at side (defaults to "id").
  relations?: Record<
    string,
    { table: () => TableDef<z.ZodRawShape>; type: "many" | "one"; fk: string; ref?: string }
  >;
}

export function autoMap(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function resolveColumn(name: string, columnMap?: Record<string, string>): string {
  const override = columnMap?.[name];
  if (override !== undefined) return override;
  return autoMap(name);
}

export interface TableRelation {
  name: string;
  table: TableDef<z.ZodRawShape>;
  type: "many" | "one";
  // For "many": FK column on the related table. For "one": FK column on this table.
  fk: string;
  // Referenced column on the pointed-at side (defaults to "id").
  ref: string;
}

export interface TableDef<Shape extends z.ZodRawShape> {
  tableName: string;
  schema: z.ZodObject<Shape>;
  columns: (keyof Shape & string)[];
  assertColumn(col: string): void;
  sqlColumn(col: string): string;
  relation(name: string): TableRelation;
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

  function relation(name: string): TableRelation {
    const rel = opts?.relations?.[name];
    if (!rel) {
      throw new UnknownRelationError(`UnknownRelation: ${name} is not a relation of table ${tableName}`);
    }
    return { name, table: rel.table(), type: rel.type, fk: rel.fk, ref: rel.ref ?? "id" };
  }

  return { tableName, schema: zodSchema, columns, assertColumn, sqlColumn, relation };
}
