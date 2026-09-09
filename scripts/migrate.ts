import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SQL } from "bun";
import { autoMap } from "../packages/rachis/src/schema";

// Thin drizzle-kit-like runner (up + status + new + generate):
//   bun scripts/migrate.ts up [dir]              apply pending *.up.sql in order
//   bun scripts/migrate.ts status [dir]          show applied vs pending
//   bun scripts/migrate.ts new <name> [dir]      scaffold timestamped up/down files
//   bun scripts/migrate.ts generate <tables-file> [dir]  emit CREATE TABLE migration from Zod schemas
// Applied files are recorded in rachis_migrations, so re-runs skip them.
// No rollback engine (out of v1 scope); apply *.down.sql manually if needed.
const dbUrl = process.env.DATABASE_URL;

const [cmd = "up", arg, argDir] = process.argv.slice(2);
const dir = cmd === "new" ? (argDir ?? "migrations") : (arg ?? "migrations");

const stamp = (): string => {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Convention (documented in the emitted file header, review before applying):
//   id: number            -> SERIAL PRIMARY KEY
//   number                -> INTEGER      string -> TEXT
//   boolean               -> BOOLEAN      date   -> TIMESTAMPTZ
//   .optional()/.nullable()/.nullish() -> nullable, otherwise NOT NULL
//   .default(literal)     -> DB DEFAULT for string/number/boolean literals
// Anything else throws instead of guessing.
const pgColumn = (col: string, field: unknown): string => {
  const name = `"${autoMap(col)}"`;
  let t = field as { _def?: { typeName?: string; innerType?: unknown; defaultValue?: unknown } };
  let nullable = false;
  let defaultClause = "";
  for (;;) {
    const tn = t?._def?.typeName;
    if (tn === "ZodOptional" || tn === "ZodNullable") {
      nullable = true;
      t = t._def.innerType as typeof t;
    } else if (tn === "ZodDefault") {
      // zod v3 stores defaults as thunks, so call once to read the value.
      // Only static literals survive: dynamic results (Date, nanoid, ...)
      // throw instead of freezing a wrong value into DDL.
      let dv: unknown = (t._def as { defaultValue?: unknown }).defaultValue;
      if (typeof dv === "function") {
        try {
          dv = (dv as () => unknown)();
        } catch {
          throw new Error(`generate: default on column "${col}" threw when evaluated (edit the file)`);
        }
      }
      if (typeof dv === "string") {
        defaultClause = ` DEFAULT '${dv.replace(/'/g, "''")}'`;
      } else if (typeof dv === "number") {
        if (!Number.isFinite(dv)) {
          throw new Error(`generate: non-finite default on column "${col}" (edit the file)`);
        }
        defaultClause = ` DEFAULT ${dv}`;
      } else if (typeof dv === "boolean") {
        defaultClause = ` DEFAULT ${dv ? "TRUE" : "FALSE"}`;
      } else {
        throw new Error(`generate: unsupported default on column "${col}" (edit the file)`);
      }
      t = t._def.innerType as typeof t;
    } else {
      break;
    }
  }
  const tn = (t as { _def?: { typeName?: string } })?._def?.typeName;
  if (col === "id" && tn === "ZodNumber" && !nullable) return `${name} SERIAL PRIMARY KEY`;
  const base =
    tn === "ZodNumber"
      ? "INTEGER"
      : tn === "ZodString"
        ? "TEXT"
        : tn === "ZodBoolean"
          ? "BOOLEAN"
          : tn === "ZodDate"
            ? "TIMESTAMPTZ"
            : null;
  if (!base) throw new Error(`generate: unsupported type ${tn ?? typeof field} on column "${col}"`);
  return `${name} ${base}${nullable ? "" : " NOT NULL"}${defaultClause}`;
};

const sql = new SQL(dbUrl ?? "");
try {
  if (cmd === "new") {
    if (!arg) throw new Error("Usage: migrate.ts new <name> [dir]");
    const slug = arg.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "migration";
    const base = `${stamp()}_${slug}`;
    await writeFile(join(dir, `${base}.up.sql`), `-- ${base}\n-- put your SQL here\n`);
    await writeFile(join(dir, `${base}.down.sql`), `-- rollback for ${base}\n-- put your SQL here\n`);
    console.log(`created ${base}.up.sql + ${base}.down.sql`);
  } else {
    if ((cmd === "status" || cmd === "up") && !dbUrl) {
      throw new Error("DATABASE_URL is not set (needed for up|status)");
    }
    const applied = new Set<string>();
    let pending: string[] = [];
    if (cmd === "status" || cmd === "up") {
      await sql`create table if not exists rachis_migrations (name text primary key, applied_at timestamptz default now())`;
      const appliedRows = (await sql`select name from rachis_migrations`) as { name: string }[];
      for (const r of appliedRows) applied.add(r.name);
      const files = (await readdir(dir)).filter((f) => f.endsWith(".up.sql")).sort();
      pending = files.filter((f) => !applied.has(f));
    }

    if (cmd === "status") {
      console.log(`applied: ${applied.size}, pending: ${pending.length}`);
      for (const f of pending) console.log(`  pending ${f}`);
    } else if (cmd === "up") {
      for (const f of pending) {
        await sql.unsafe(await readFile(join(dir, f), "utf8"));
        await sql`insert into rachis_migrations (name) values (${f})`;
        console.log(`applied ${f}`);
      }
      if (pending.length === 0) console.log("up to date");
    } else if (cmd === "generate") {
      const tablesFile = arg;
      const outDir = argDir ?? "migrations";
      if (!tablesFile) throw new Error("Usage: migrate.ts generate <tables-file> [dir]");
      const mod = (await import(pathToFileURL(resolve(tablesFile)).href)) as Record<string, unknown>;
      const tables = Object.values(mod).filter(
        (v): v is { tableName: string; schema: { shape: Record<string, unknown> } } =>
          !!v &&
          typeof v === "object" &&
          typeof (v as { tableName?: unknown }).tableName === "string" &&
          !!(v as { schema?: { shape?: unknown } }).schema?.shape,
      );
      if (tables.length === 0) {
        throw new Error(`no tables found in ${tablesFile} (export defineTable(...) results)`);
      }
      const ups: string[] = [];
      const downs: string[] = [];
      for (const t of tables) {
        const cols = Object.entries(t.schema.shape).map(([col, field]) => `  ${pgColumn(col, field)}`);
        ups.push(`CREATE TABLE IF NOT EXISTS "${t.tableName}" (\n${cols.join(",\n")}\n);`);
        downs.push(`DROP TABLE IF EXISTS "${t.tableName}";`);
      }
      const base = `${stamp()}_generated`;
      const header = `-- generated from ${tablesFile} -- review before applying\n-- id: number -> SERIAL PRIMARY KEY; number -> INTEGER; string -> TEXT; boolean -> BOOLEAN; date -> TIMESTAMPTZ; optional/nullable -> nullable, else NOT NULL; .default(literal) -> DB DEFAULT\n`;
      await writeFile(join(outDir, `${base}.up.sql`), `${header}${ups.join("\n")}\n`);
      await writeFile(join(outDir, `${base}.down.sql`), `${downs.join("\n")}\n`);
      console.log(`created ${base}.up.sql + ${base}.down.sql (${tables.length} tables)`);
    } else {
      throw new Error(`unknown command: ${cmd} (use up|status|new|generate)`);
    }
  }
} finally {
  await sql.close();
}
