import type { z } from "zod";
import { UnknownOperatorError, UnsafeFullTableError } from "./errors";
import type { TableDef } from "./schema";

export type ComparisonOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "LIKE" | "NOT LIKE";

const OPERATORS: ReadonlySet<string> = new Set([
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "LIKE",
  "NOT LIKE",
  "IN",
  "NOT IN",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
]);

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
  offset = 0,
  joiner = " AND ",
): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const w of wheres) {
    if (!OPERATORS.has(w.op)) {
      throw new UnknownOperatorError(`UnknownOperator: ${String(w.op)} is not a supported operator`);
    }
    const col = table.sqlColumn(w.col);
    switch (w.op) {
      case "IS NULL":
      case "IS NOT NULL":
        parts.push(`${col} ${w.op}`);
        break;
      case "BETWEEN": {
        const [a, b] = w.val;
        const [p1, p2] = placeholders(params.length + 1 + offset, 2);
        parts.push(`${col} BETWEEN ${p1} AND ${p2}`);
        params.push(a, b);
        break;
      }
      case "IN":
      case "NOT IN": {
        const ph = placeholders(params.length + 1 + offset, w.val.length);
        parts.push(`${col} ${w.op} (${ph.join(", ")})`);
        params.push(...w.val);
        break;
      }
      default: {
        const p = `$${params.length + 1 + offset}`;
        parts.push(`${col} ${w.op} ${p}`);
        params.push(w.val);
        break;
      }
    }
  }
  return { clause: parts.join(joiner), params };
}

function buildFilter<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  wheres: Where<Shape>[],
  orGroups: Where<Shape>[][],
  baseOffset = 0,
): { text: string; params: unknown[] } {
  const { clause, params } = buildWhere(table, wheres, baseOffset);
  const parts = clause ? [clause] : [];
  const all = [...params];
  for (const g of orGroups) {
    const r = buildWhere(table, g, baseOffset + all.length, " OR ");
    parts.push(`(${r.clause})`);
    all.push(...r.params);
  }
  return { text: parts.join(" AND "), params: all };
}

const requireNonEmptyGroup = (clauses: unknown[]): void => {
  if (clauses.length === 0) {
    throw new Error("orWhere requires at least one condition");
  }
};

export type RowInput<Shape extends z.ZodRawShape> = Partial<Record<keyof Shape & string, unknown>>;

export type OrderDir = "ASC" | "DESC";

export interface OrderClause<Shape extends z.ZodRawShape> {
  col: keyof Shape & string;
  dir: OrderDir;
}

export type JoinType = "INNER" | "LEFT";

export interface JoinOn<BShape extends z.ZodRawShape, JShape extends z.ZodRawShape> {
  left: keyof BShape & string;
  right: keyof JShape & string;
}

export interface JoinSpec<BShape extends z.ZodRawShape, JShape extends z.ZodRawShape> {
  table: TableDef<JShape>;
  type: JoinType;
  on: JoinOn<BShape, JShape>[];
  select: (keyof JShape & string)[];
}

interface StoredJoin {
  table: TableDef<z.ZodRawShape>;
  type: JoinType;
  on: { left: string; right: string }[];
  select: string[];
}

export interface SelectBuilder<Shape extends z.ZodRawShape> {
  select(...cols: (keyof Shape & string)[]): SelectBuilder<Shape>;
  where(clause: Where<Shape>): SelectBuilder<Shape>;
  orWhere(clauses: Where<Shape>[]): SelectBuilder<Shape>;
  join<J extends z.ZodRawShape>(table: TableDef<J>, spec: Omit<JoinSpec<Shape, J>, "table">): SelectBuilder<Shape>;
  orderBy(col: keyof Shape & string, dir?: OrderDir): SelectBuilder<Shape>;
  limit(n: number): SelectBuilder<Shape>;
  offset(n: number): SelectBuilder<Shape>;
  insert(row: RowInput<Shape>): InsertBuilder;
  update(patch: RowInput<Shape>): UpdateBuilder<Shape>;
  delete(): DeleteBuilder<Shape>;
  toSQL(): BuiltQuery;
}

export interface InsertBuilder {
  toSQL(): BuiltQuery;
}

export interface UpdateBuilder<Shape extends z.ZodRawShape> {
  where(clause: Where<Shape>): UpdateBuilder<Shape>;
  orWhere(clauses: Where<Shape>[]): UpdateBuilder<Shape>;
  toSQL(): BuiltQuery;
}

export interface DeleteBuilder<Shape extends z.ZodRawShape> {
  where(clause: Where<Shape>): DeleteBuilder<Shape>;
  orWhere(clauses: Where<Shape>[]): DeleteBuilder<Shape>;
  toSQL(): BuiltQuery;
}

export function query<Shape extends z.ZodRawShape>(table: TableDef<Shape>): SelectBuilder<Shape> {
  return createBuilder(table, [], []);
}

function createBuilder<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  selected: (keyof Shape & string)[],
  wheres: Where<Shape>[],
  orderBys: OrderClause<Shape>[] = [],
  limitVal?: number,
  offsetVal?: number,
  orGroups: Where<Shape>[][] = [],
  joins: StoredJoin[] = [],
): SelectBuilder<Shape> {
  const next = (
    selectedNext: (keyof Shape & string)[],
    wheresNext: Where<Shape>[],
    orderBysNext: OrderClause<Shape>[] = orderBys,
    limitNext: number | undefined = limitVal,
    offsetNext: number | undefined = offsetVal,
    orGroupsNext: Where<Shape>[][] = orGroups,
    joinsNext: StoredJoin[] = joins,
  ): SelectBuilder<Shape> =>
    createBuilder(table, selectedNext, wheresNext, orderBysNext, limitNext, offsetNext, orGroupsNext, joinsNext);
  return {
    select(...cols: (keyof Shape & string)[]): SelectBuilder<Shape> {
      return next([...selected, ...cols], wheres);
    },
    where(clause: Where<Shape>): SelectBuilder<Shape> {
      return next(selected, [...wheres, clause]);
    },
    orWhere(clauses: Where<Shape>[]): SelectBuilder<Shape> {
      requireNonEmptyGroup(clauses);
      return next(selected, wheres, orderBys, limitVal, offsetVal, [...orGroups, clauses]);
    },
    join<J extends z.ZodRawShape>(joinTable: TableDef<J>, spec: Omit<JoinSpec<Shape, J>, "table">): SelectBuilder<Shape> {
      if (spec.type !== "INNER" && spec.type !== "LEFT") {
        throw new UnknownOperatorError(`UnknownOperator: ${String(spec.type)} is not a valid join type`);
      }
      if (spec.on.length === 0) {
        throw new Error("join requires at least one ON condition");
      }
      return next(selected, wheres, orderBys, limitVal, offsetVal, orGroups, [
        ...joins,
        {
          table: joinTable as TableDef<z.ZodRawShape>,
          type: spec.type,
          on: spec.on.map((o) => ({ left: o.left as string, right: o.right as string })),
          select: spec.select.map((c) => c as string),
        },
      ]);
    },
    orderBy(col: keyof Shape & string, dir: OrderDir = "ASC"): SelectBuilder<Shape> {
      if (dir !== "ASC" && dir !== "DESC") {
        throw new UnknownOperatorError(`UnknownOperator: ${String(dir)} is not a valid sort direction`);
      }
      return next(selected, wheres, [...orderBys, { col, dir }]);
    },
    limit(n: number): SelectBuilder<Shape> {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`limit must be a non-negative integer, got ${String(n)}`);
      }
      return next(selected, wheres, orderBys, n, offsetVal);
    },
    offset(n: number): SelectBuilder<Shape> {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`offset must be a non-negative integer, got ${String(n)}`);
      }
      return next(selected, wheres, orderBys, limitVal, n);
    },
    insert(row: RowInput<Shape>): InsertBuilder {
      return createInsertBuilder(table, row);
    },
    update(patch: RowInput<Shape>): UpdateBuilder<Shape> {
      return createUpdateBuilder(table, patch, []);
    },
    delete(): DeleteBuilder<Shape> {
      return createDeleteBuilder(table, []);
    },
    toSQL(): BuiltQuery {
      for (const c of selected) table.assertColumn(c);
      const q = (t: TableDef<z.ZodRawShape>, c: string): string => `${t.tableName}.${t.sqlColumn(c)}`;
      const baseList =
        joins.length === 0
          ? [selected.length === 0 ? "*" : selected.map((c) => table.sqlColumn(c)).join(", ")]
          : [
              selected.length === 0
                ? `${table.tableName}.*`
                : selected.map((c) => q(table as TableDef<z.ZodRawShape>, c)).join(", "),
            ];
      const joinList = joins.flatMap((j) =>
        j.select.map((c) => {
          const col = j.table.sqlColumn(c);
          return `${j.table.tableName}.${col} AS ${j.table.tableName}_${col}`;
        }),
      );
      let sql = `SELECT ${[...baseList, ...joinList].join(", ")} FROM ${table.tableName}`;
      for (const j of joins) {
        const on = j.on
          .map((o) => `${table.tableName}.${table.sqlColumn(o.left)} = ${j.table.tableName}.${j.table.sqlColumn(o.right)}`)
          .join(" AND ");
        sql += ` ${j.type} JOIN ${j.table.tableName} ON ${on}`;
      }
      const { text, params } = buildFilter(table, wheres, orGroups);
      if (text) sql += ` WHERE ${text}`;
      if (orderBys.length > 0) {
        sql += ` ORDER BY ${orderBys.map((o) => `${table.sqlColumn(o.col)} ${o.dir}`).join(", ")}`;
      }
      if (limitVal !== undefined) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(limitVal);
      }
      if (offsetVal !== undefined) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(offsetVal);
      }
      return { sql, params };
    },
  };
}

function createInsertBuilder<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  row: RowInput<Shape>,
): InsertBuilder {
  return {
    toSQL(): BuiltQuery {
      const keys = Object.keys(row) as (keyof Shape & string)[];
      if (keys.length === 0) {
        throw new UnsafeFullTableError(`UnsafeFullTable: insert on ${table.tableName} with empty row is not allowed`);
      }
      const cols = keys.map((k) => table.sqlColumn(k));
      const vals = keys.map((k) => row[k]);
      const ph = placeholders(1, keys.length);
      return {
        sql: `INSERT INTO ${table.tableName} (${cols.join(", ")}) VALUES (${ph.join(", ")}) RETURNING *`,
        params: vals,
      };
    },
  };
}

function createUpdateBuilder<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  patch: RowInput<Shape>,
  wheres: Where<Shape>[],
  orGroups: Where<Shape>[][] = [],
): UpdateBuilder<Shape> {
  return {
    where(clause: Where<Shape>): UpdateBuilder<Shape> {
      return createUpdateBuilder(table, patch, [...wheres, clause], orGroups);
    },
    orWhere(clauses: Where<Shape>[]): UpdateBuilder<Shape> {
      requireNonEmptyGroup(clauses);
      return createUpdateBuilder(table, patch, wheres, [...orGroups, clauses]);
    },
    toSQL(): BuiltQuery {
      const keys = Object.keys(patch) as (keyof Shape & string)[];
      if (keys.length === 0) {
        throw new UnsafeFullTableError(`UnsafeFullTable: update on ${table.tableName} with empty patch is not allowed`);
      }
      if (wheres.length === 0 && orGroups.length === 0) {
        throw new UnsafeFullTableError(`UnsafeFullTable: update on ${table.tableName} without where is not allowed`);
      }
      const setParts = keys.map((k, i) => `${table.sqlColumn(k)} = $${i + 1}`);
      const setParams = keys.map((k) => patch[k]);
      const { text, params: whereParams } = buildFilter(table, wheres, orGroups, setParams.length);
      return {
        sql: `UPDATE ${table.tableName} SET ${setParts.join(", ")} WHERE ${text} RETURNING *`,
        params: [...setParams, ...whereParams],
      };
    },
  };
}

function createDeleteBuilder<Shape extends z.ZodRawShape>(
  table: TableDef<Shape>,
  wheres: Where<Shape>[],
  orGroups: Where<Shape>[][] = [],
): DeleteBuilder<Shape> {
  return {
    where(clause: Where<Shape>): DeleteBuilder<Shape> {
      return createDeleteBuilder(table, [...wheres, clause], orGroups);
    },
    orWhere(clauses: Where<Shape>[]): DeleteBuilder<Shape> {
      requireNonEmptyGroup(clauses);
      return createDeleteBuilder(table, wheres, [...orGroups, clauses]);
    },
    toSQL(): BuiltQuery {
      if (wheres.length === 0 && orGroups.length === 0) {
        throw new UnsafeFullTableError(`UnsafeFullTable: delete on ${table.tableName} without where is not allowed`);
      }
      const { text, params } = buildFilter(table, wheres, orGroups);
      return { sql: `DELETE FROM ${table.tableName} WHERE ${text}`, params };
    },
  };
}
