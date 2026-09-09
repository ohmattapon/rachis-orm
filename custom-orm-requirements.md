# Requirement คร่าวๆ: Custom ORM (TypeScript)

# ORM ตัวนี้ชื่อ Rachis

## เป้าหมายโปรเจกต์
สร้าง ORM ใช้เองสำหรับ stack ภายในทีม (TypeScript + Bun + PostgreSQL + hexagonal architecture) แทนการพึ่ง library ภายนอกอย่าง Prisma/TypeORM

## หลักการ (Non-negotiable)
| หลักการ | ความหมาย |
|---|---|
| ใช้ง่าย | API surface เล็ก เรียนรู้ได้ภายในไม่กี่ชั่วโมง ไม่มี magic ที่ต้องอธิบายเยอะ |
| ปลอดภัย | ทุก query ต้องเป็น parameterized query เท่านั้น ห้าม string concat; column/table name ต้อง whitelist จาก schema เท่านั้น |
| เบา | ไม่ใช้ decorator + reflect-metadata, ไม่มี native binary, ไม่มี code generation step แยก, dependency น้อยที่สุด |
| เรียนรู้เร็ว | ทุกพฤติกรรมต้อง explicit ไม่มี auto-join / lazy loading แบบซ่อนเงื่อนไข |

## สถาปัตยกรรมที่เสนอ (4 ชั้น)
1. **Schema layer** — นิยามตาราง + validation ด้วย Zod (schema เดียวใช้ทั้ง validate และ infer type)
2. **Query builder** — สร้าง SQL string + parameter array เท่านั้น ไม่ execute เอง
3. **Executor** — รับ SQL + params ไปรันผ่าน driver (Bun.sql)
4. **Repository (port/adapter)** — ห่อ query builder เป็น method ตาม use case ของแต่ละ domain ให้เข้ากับ hexagonal architecture ที่ทีมใช้อยู่

## ขอบเขตเวอร์ชันแรก (v1 / MVP)
**อยู่ในสโคป**
- CRUD พื้นฐาน: `select`, `insert`, `update`, `delete`
- `where` แบบ AND เท่านั้น (ยังไม่รองรับ OR/nested condition ซับซ้อน)
- Type inference จาก Zod schema
- Unit test query builder แบบไม่ต้องต่อ DB จริง (เช็คแค่ SQL string + params ที่ generate ออกมา)

**นอกสโคป (พิจารณารอบถัดไป)**
- Relation / auto-join
- Migration system (ใช้ SQL file เขียนเองไปก่อน)
- Connection pooling abstraction (ใช้ของ driver ตรงๆ)
- รองรับ database อื่นนอกจาก PostgreSQL
- Caching layer

## ประเด็นที่อยากคุยกับทีม
1. Naming convention: mapping `camelCase` (โค้ด) ↔ `snake_case` (คอลัมน์ใน DB) — auto-map หรือ define เองต่อ table
2. ควรมี raw SQL escape hatch สำหรับ query ที่ query builder ยังรองรับไม่ถึงหรือไม่ และควรจำกัดการใช้แค่ไหน
3. แผนระยะสั้นสำหรับ migration (ใครเขียน SQL migration, เก็บไว้ที่ไหน, versioning ยังไง)
4. จะแยกเป็น internal package (เช่น publish ใน private registry) หรือฝังไว้ใน repo หลักไปก่อน
5. Test strategy: unit test เฉพาะ query builder พอ หรือต้องมี integration test กับ Postgres จริงด้วย
