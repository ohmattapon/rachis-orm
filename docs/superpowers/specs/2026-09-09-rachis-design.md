# Rachis ORM — Design (2026-09-09)

## 1. Context
Custom ORM ใช้เองสำหรับ stack ภายในทีม (TypeScript + Bun + PostgreSQL + hexagonal).
แทน Prisma/TypeORM. หลัก non-negotiable: ใช้ง่าย, ปลอดภัย (parameterized only + whitelist),
เบา (no decorator/reflect-metadata, no native binary, no codegen), explicit (no auto-join/lazy).

## 2. Decisions (grill locked)
1. Naming: A — auto-map `camelCase -> snake_case` ทั้งหมด. Regex เดียว `([a-z0-9])([A-Z]) -> $1_$2` ตัวเล็กหมด. ชื่อประหลาด (`userID`, `URLValue`) ให้ override ราย field ไม่แก้ regex ตาม.
2. Raw: B — escape hatch แบบจำกัด เฉพาะที่ builder ไปไม่ถึง. บังคับ parameterized + whitelist table. raw ใช้ชื่อฝั่ง DB (`snake_case`). ปฏิเสธ `;`, `--`, `/*`. ต้อง comment ว่าทำไม builder ทำไม่ได้.
3. Test: B — unit (SQL+params) + integration (docker Postgres) ตั้งแต่ v1.
4. Migration: B — SQL file มือ + `/migrations` + timestamp + script up/down บางๆ. ไม่อยู่ใน package.
5. Packaging: B — internal package ใน monorepo (`packages/rachis`). ยังไม่ publish registry ใน v1.
6. Safety: A — `update/delete` ไม่มี `where` ให้ throw `UnsafeFullTableError` ทันที. v1 ไม่มี bypass flag.
7. Where: C — AND เท่านั้น + operator เยอะ: `=, !=, >, >=, <, <=, IN, NOT IN, LIKE, NOT LIKE, BETWEEN, IS NULL / IS NOT NULL`.

## 3. Approach (locked): chain บางๆ + where object
`query(users).select(...).where({...}).where({...}).toSQL()` — ผสม function + fluent.
`.where()` ตัวเดียวรับ discriminated union (ไม่ระเบิด method). หลายครั้ง = AND.

## 4. Architecture
```
packages/rachis/
  src/schema.ts    // defineTable + auto-map
  src/builder.ts   // query().select/where/insert/update/delete/toSQL
  src/executor.ts  // execute() ผ่าน Bun.sql + raw แบบจำกัด
  src/errors.ts    // 4 errors
```

## 5. Schema layer
```ts
const userSchema = z.object({ id: z.number(), firstName: z.string(), age: z.number(), status: z.string(), deletedAt: z.date().nullable() });
const users = defineTable('users', userSchema);
type User = z.infer<typeof userSchema>;
```
- key ฝั่งโค้ด `camelCase`, ชื่อตารางจริง `snake_case`. whitelist: col ไม่อยู่ใน schema -> throw `UnknownColumnError` ตั้งแต่ build.

## 6. Builder
```ts
type Where<T> =
  | { col: keyof T, op: '=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', val: unknown }
  | { col: keyof T, op: 'IN', 'NOT IN', val: unknown[] }
  | { col: keyof T, op: 'BETWEEN', val: [unknown, unknown] }
  | { col: keyof T, op: 'IS NULL', 'IS NOT NULL' };

query(users).select('id', 'firstName', 'age')
  .where({ col: 'age', op: 'BETWEEN', val: [18, 30] })
  .where({ col: 'deletedAt', op: 'IS NULL' })
  .toSQL(); // -> { sql, params }

query(users).insert({ firstName: 'A', age: 20, status: 'active' }).toSQL();
query(users).update({ status: 'inactive' }).where({ col: 'id', op: '=', val: 1 }).toSQL();
query(users).delete().where({ col: 'id', op: '=', val: 1 }).toSQL();
```
Rules: `.where()` immutable (คืนตัวใหม่). ไม่เรียก `.select()` = `SELECT *` (แนะนำระบุเสมอ). `update/delete` + `where` ว่าง + `.toSQL()` -> throw. whitelist + auto-map ทำตอน `.toSQL()` จุดเดียว, params ลำดับ `$1, $2...`.

## 7. Executor + raw
```ts
const q = query(users).select('id').where({ col: 'id', op: '=', val: 1 }).toSQL();
const rows = await execute<User>(db, q); // db = Bun.sql instance, ไม่ทำ pool เอง
raw(users, 'age > $1 AND deleted_at IS NULL', [20]).toSQL();
```
Errors v1 (4 ตัว): `UnknownColumnError`, `UnknownTableError`, `UnsafeFullTableError`, `UnsafeRawError`. throw ตั้งแต่ build.

## 8. Repository (hexagonal)
```ts
const userRepo = {
  findActiveAdults: (db: Db) => execute<User>(db, query(users).select('id', 'firstName')
    .where({ col: 'age', op: 'BETWEEN', val: [18, 30] })
    .where({ col: 'status', op: '=', val: 'active' }).toSQL()),
  deactivate: (db: Db, id: number) => execute(db, query(users).update({ status: 'inactive' }).where({ col: 'id', op: '=', val: id }).toSQL()),
};
```

## 9. Test
- unit (ไม่ต่อ DB): assert `toSQL()` -> sql+params ตรงทุก op + guard throw + auto-map.
- integration (docker PG): smoke CRUD happy path ผ่าน `execute()` จริง.

## 10. Self-review
- Placeholder: ไม่มี TBD. Migration script รายละเอียด impl อยู่ในแผนถัดไป (ตั้งใจ).
- Consistency: raw ใช้ snake_case สอดคล้อง auto-map; guard + whitelist สอดคล้องหลักปลอดภัย; package monorepo สอดคล้องระยะยาว.
- Scope: v1 เดียว (AND only, no join/relation, no pool abstraction, PG only, no cache).
- Ambiguity: `SELECT *` default ระบุชัดแล้ว; `BETWEEN` inclusive ตาม SQL มาตรฐาน; `LIKE` ไม่ auto-escape `%` (ส่งค่าดิบผ่าน params).
