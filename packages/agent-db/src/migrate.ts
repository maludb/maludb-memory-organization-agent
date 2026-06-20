import type { Pool } from "pg";

import { migrations } from "./migrations/index.js";

/**
 * Apply pending migrations inside transactions, tracking applied ids in
 * schema_migrations. Idempotent: already-applied migrations are skipped. Returns the
 * ids that ran this time.
 */
export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const appliedRes = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const applied = new Set(appliedRes.rows.map((r) => r.id));

    const ran: string[] = [];
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        ran.push(m.id);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return ran;
  } finally {
    client.release();
  }
}
