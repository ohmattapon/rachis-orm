import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";

// Thin up-only migration runner (v1): applies *.up.sql in timestamp order.
// No rollback engine (out of v1 scope); use *.down.sql manually if needed.
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL is not set");
}

const dir = process.argv[2] ?? "migrations";
const sql = new SQL(dbUrl);

const files = (await readdir(dir))
  .filter((f) => f.endsWith(".up.sql"))
  .sort();

for (const f of files) {
  const text = await readFile(join(dir, f), "utf8");
  await sql.unsafe(text);
  console.log(`applied ${f}`);
}

await sql.close();
