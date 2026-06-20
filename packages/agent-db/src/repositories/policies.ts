import type { Queryable } from "../pool.js";
import type { PolicyRow } from "../types.js";

const COLS = `id, tenant, version, document, created_at AS "createdAt"`;

export interface InsertPolicyInput {
  id: string;
  tenant: string;
  version: number;
  document: unknown;
}

export async function insertPolicy(db: Queryable, p: InsertPolicyInput): Promise<PolicyRow> {
  const res = await db.query<PolicyRow>(
    `INSERT INTO policies (id, tenant, version, document)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (tenant, version) DO UPDATE SET document = EXCLUDED.document
     RETURNING ${COLS}`,
    [p.id, p.tenant, p.version, JSON.stringify(p.document)],
  );
  return res.rows[0]!;
}

export async function getPolicy(db: Queryable, id: string): Promise<PolicyRow | null> {
  const res = await db.query<PolicyRow>(`SELECT ${COLS} FROM policies WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function getLatestPolicy(db: Queryable, tenant: string): Promise<PolicyRow | null> {
  const res = await db.query<PolicyRow>(
    `SELECT ${COLS} FROM policies WHERE tenant = $1 ORDER BY version DESC LIMIT 1`,
    [tenant],
  );
  return res.rows[0] ?? null;
}

export async function listPolicies(db: Queryable, tenant?: string): Promise<PolicyRow[]> {
  if (tenant !== undefined) {
    const res = await db.query<PolicyRow>(
      `SELECT ${COLS} FROM policies WHERE tenant = $1 ORDER BY version DESC`,
      [tenant],
    );
    return res.rows;
  }
  const res = await db.query<PolicyRow>(`SELECT ${COLS} FROM policies ORDER BY tenant, version DESC`);
  return res.rows;
}
