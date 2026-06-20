import type { Queryable } from "../pool.js";
import type { TenantRow } from "../types.js";

const COLS = `id, api_base_url AS "apiBaseUrl", token_ref AS "tokenRef", namespace, enabled,
  policy_id AS "policyId", capabilities, health, health_status AS "healthStatus",
  last_health_at AS "lastHealthAt", created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface UpsertTenantInput {
  id: string;
  apiBaseUrl: string;
  tokenRef: string;
  namespace?: string;
  enabled?: boolean;
  policyId?: string | null;
}

export async function upsertTenant(db: Queryable, t: UpsertTenantInput): Promise<TenantRow> {
  const res = await db.query<TenantRow>(
    `INSERT INTO tenants (id, api_base_url, token_ref, namespace, enabled, policy_id)
     VALUES ($1, $2, $3, COALESCE($4, 'default'), COALESCE($5, true), $6)
     ON CONFLICT (id) DO UPDATE SET
       api_base_url = EXCLUDED.api_base_url,
       token_ref    = EXCLUDED.token_ref,
       namespace    = EXCLUDED.namespace,
       enabled      = EXCLUDED.enabled,
       policy_id    = EXCLUDED.policy_id,
       updated_at   = now()
     RETURNING ${COLS}`,
    [t.id, t.apiBaseUrl, t.tokenRef, t.namespace ?? null, t.enabled ?? null, t.policyId ?? null],
  );
  return res.rows[0]!;
}

export async function getTenant(db: Queryable, id: string): Promise<TenantRow | null> {
  const res = await db.query<TenantRow>(`SELECT ${COLS} FROM tenants WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listTenants(
  db: Queryable,
  opts: { enabledOnly?: boolean } = {},
): Promise<TenantRow[]> {
  const where = opts.enabledOnly ? "WHERE enabled = true" : "";
  const res = await db.query<TenantRow>(`SELECT ${COLS} FROM tenants ${where} ORDER BY id`);
  return res.rows;
}

export async function setTenantEnabled(db: Queryable, id: string, enabled: boolean): Promise<void> {
  await db.query(`UPDATE tenants SET enabled = $2, updated_at = now() WHERE id = $1`, [id, enabled]);
}

export interface TenantHealthUpdate {
  healthy: boolean;
  capabilities: Record<string, boolean>;
  health: unknown;
}

export async function updateTenantHealth(
  db: Queryable,
  id: string,
  update: TenantHealthUpdate,
): Promise<void> {
  await db.query(
    `UPDATE tenants
     SET capabilities = $2::jsonb, health = $3::jsonb, health_status = $4,
         last_health_at = now(), updated_at = now()
     WHERE id = $1`,
    [
      id,
      JSON.stringify(update.capabilities),
      JSON.stringify(update.health ?? null),
      update.healthy ? "healthy" : "unhealthy",
    ],
  );
}
