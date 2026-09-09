import type { z } from "zod";
import type { TableDef } from "./schema";

export type ComparisonOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "LIKE" | "NOT LIKE";

export type Where<Shape extends z.ZodRawShape> =
  | { col: keyof Shape & string; op: ComparisonOp; val: unknown }
  | { col: keyof Shape & string; op: "IN" | "NOT IN"; val: unknown[] }
  | { col: keyof Shape & string; op: "BETWEEN"; val: [unknown, unknown] }
  | { col: keyof Shape & string; op: "IS NULL" | "IS NOT NULL" };

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

function placeholders(start: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`$${start + i}`);
  return out;
}

function buildWhere<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  wheres: Where<Shape>[],
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const w of wheres) {
    const col = table.sqlColumn(w.col);
    switch (w.op) {
      case "IS NULL":
      case "IS NOT NULL":
        parts.push(`${col} ${w.op}`);
        break;
      case "BETWEEN": {
        const [a, b] = w.val;
        const [p1, p2] = placeholders(params.length + 1, 2);
        parts.push(`${col} BETWEEN ${p1} AND ${p2}`);
        params.push(a, b);
        break;
      }
      case "IN":
      case "NOT IN": {
        const ph = placeholders(params.length + 1, w.val.length);
        parts.push(`${col} ${w.op} (${ph.join(", ")})`);
        params.push(...w.val);
        break;
      }
      default: {
        const p = `$${params.length + 1}`;
        parts.push(`${col} ${w.op} ${p}`);
        params.push(w.val);
        break;
      }
    }
  }
  return { clause: parts.join(" AND "), params };
}

export interface SelectBuilder<Shape extends z.ZodRawShape> {
  select(...cols: (keyof Shape & string)[]): SelectBuilder<Shape>;
  where(clause: Where<Shape>): SelectBuilder<Shape>;
  toSQL(): BuiltQuery;
}

export function query<Shape extends z.ZodRawShape>(table: TableDef<Shape>): SelectBuilder<Shape> {
  return createBuilder(table, [], []);
}

function createBuilder<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  selected: (keyof Shape & string)[],
  wheres: Where<Shape>[],
): SelectBuilder<Shape> {
  return {
    select(...cols: (keyof Shape & string)[]): SelectBuilder<Shape> {
      return createBuilder(table, [...selected, ...cols], wheres);
    },
    where(clause: Where<Shape>): SelectBuilder<Shape> {
      return createBuilder(table, selected, [...wheres, clause]);
    },
    toSQL(): BuiltQuery {
      for (const c of selected) table.assertColumn(c);
      const selectList = selected.length === 0 ? "*" : selected.map((c) => table.sqlColumn(c)).join(", ");
      let sql = `SELECT ${selectList} FROM ${table.tableName}`;
      const { clause, params } = buildWhere(table, wheres);
      if (clause) sql += ` WHERE ${clause}`;
      return { sql, params };
    },
  };
}
