import type { JobType } from "@maludb-agent/job-contracts";

import type { Queryable } from "../pool.js";

/** Read a job's resume cursor for a tenant (docs/worker-design.md §3, RR-2). */
export async function getWatermark(
  db: Queryable,
  tenantId: string,
  jobType: JobType,
): Promise<unknown> {
  const res = await db.query<{ cursor: unknown }>(
    `SELECT cursor FROM watermarks WHERE tenant_id = $1 AND job_type = $2`,
    [tenantId, jobType],
  );
  return res.rows[0]?.cursor ?? null;
}

/** Upsert a job's resume cursor for a tenant. */
export async function setWatermark(
  db: Queryable,
  tenantId: string,
  jobType: JobType,
  cursor: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO watermarks (tenant_id, job_type, cursor)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, job_type)
       DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
    [tenantId, jobType, JSON.stringify(cursor ?? null)],
  );
}
