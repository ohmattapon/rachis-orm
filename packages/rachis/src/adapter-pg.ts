import type { Pool, PoolClient } from "pg";
import type { Db } from "./executor.ts";

// Node.js adapter for node-postgres (`pg` package, a peer dependency).
// Accepts a Pool (recommended: it manages connections) or a single Client.
// Values travel as params exactly like the Bun path, so the same guards hold.
export function toPgPool(pool: Pool): Db {
  return {
    query: async (text: string, params: unknown[]): Promise<unknown[]> => {
      const res = await pool.query(text, params as never[]);
      return res.rows as unknown[];
    },
  };
}

export function toPgClient(client: PoolClient): Db {
  return {
    query: async (text: string, params: unknown[]): Promise<unknown[]> => {
      const res = await client.query(text, params as never[]);
      return res.rows as unknown[];
    },
  };
}
