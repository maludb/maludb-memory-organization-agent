import type { Queryable } from "../pool.js";

export interface RecordCostInput {
  tenantId: string;
  jobRunId?: string;
  model?: string;
  calls?: number;
  tokens?: number;
  /** ISO date (YYYY-MM-DD); defaults to the DB's CURRENT_DATE. */
  day?: string;
}

/** Append a cost event. cost_records is append-only; daily totals are summed on read. */
export async function recordCost(db: Queryable, c: RecordCostInput): Promise<void> {
  await db.query(
    `INSERT INTO cost_records (tenant_id, job_run_id, model, calls, tokens, day)
     VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, 0), COALESCE($6::date, CURRENT_DATE))`,
    [c.tenantId, c.jobRunId ?? null, c.model ?? null, c.calls ?? null, c.tokens ?? null, c.day ?? null],
  );
}

export interface DailyCost {
  calls: number;
  tokens: number;
}

/** Sum a tenant's model spend for a day (defaults to today), for cost-control checks. */
export async function getDailyCost(
  db: Queryable,
  tenantId: string,
  day?: string,
): Promise<DailyCost> {
  const res = await db.query<DailyCost>(
    `SELECT COALESCE(SUM(calls), 0)::int AS calls, COALESCE(SUM(tokens), 0)::int AS tokens
     FROM cost_records
     WHERE tenant_id = $1 AND day = COALESCE($2::date, CURRENT_DATE)`,
    [tenantId, day ?? null],
  );
  return res.rows[0] ?? { calls: 0, tokens: 0 };
}
