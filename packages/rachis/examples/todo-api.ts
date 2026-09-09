import { SQL } from "bun";
import { z } from "zod";
import { defineTable } from "../src/schema";
import { query } from "../src/builder";
import { execute } from "../src/executor";
import { toDb } from "../src/adapter";

// Demo: Todo mini-API on top of Rachis v1. Run with:
//   DATABASE_URL="<neon url>" bun packages/rachis/examples/todo-api.ts
// Then: curl localhost:3456/todos

const todoSchema = z.object({
  id: z.number(),
  title: z.string(),
  status: z.string(),
});
type Todo = z.infer<typeof todoSchema>;
const todos = defineTable("todos", todoSchema);

const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) throw new Error("Set DATABASE_URL first");
const sql = new SQL(dbUrl);
const db = toDb(sql);

await sql`create table if not exists todos (id serial primary key, title text not null, status text not null default 'active')`;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const server = Bun.serve({
  port: 3456,
  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);

      // GET /todos?status=active&q=foo
      if (req.method === "GET" && url.pathname === "/todos") {
        let q = query(todos).select("id", "title", "status");
        const status = url.searchParams.get("status");
        const term = url.searchParams.get("q");
        if (status) q = q.where({ col: "status", op: "=", val: status });
        if (term) q = q.where({ col: "title", op: "LIKE", val: `%${term}%` });
        return json(await execute<Todo>(db, q.toSQL()));
      }

      // POST /todos { title, status? }
      if (req.method === "POST" && url.pathname === "/todos") {
        const body = (await req.json()) as { title?: string; status?: string };
        if (!body.title) return json({ error: "title is required" }, 400);
        const ins = query(todos)
          .insert({ title: body.title, status: body.status ?? "active" })
          .toSQL();
        const rows = await execute<Todo>(db, ins);
        return json(rows[0], 201);
      }

      const idMatch = url.pathname.match(/^\/todos\/(\d+)$/);
      if (idMatch) {
        const id = Number(idMatch[1]);

        // PATCH /todos/:id { title?, status? }
        if (req.method === "PATCH") {
          const body = (await req.json()) as { title?: string; status?: string };
          const patch: Record<string, unknown> = {};
          if (body.title !== undefined) patch["title"] = body.title;
          if (body.status !== undefined) patch["status"] = body.status;
          const rows = await execute<Todo>(
            db,
            query(todos).update(patch).where({ col: "id", op: "=", val: id }).toSQL(),
          );
          if (rows.length === 0) return json({ error: "not found" }, 404);
          return json(rows[0]);
        }

        // DELETE /todos/:id
        if (req.method === "DELETE") {
          await execute(db, query(todos).delete().where({ col: "id", op: "=", val: id }).toSQL());
          return json({ ok: true });
        }
      }

      // GET /guard-demo — proves update-without-where is blocked (Q6-A)
      if (req.method === "GET" && url.pathname === "/guard-demo") {
        try {
          query(todos).update({ status: "x" }).toSQL();
          return json({ blocked: false });
        } catch (err) {
          return json({ blocked: true, error: (err as Error).message });
        }
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
});

console.log(`todo-api listening on http://localhost:${server.port}`);
