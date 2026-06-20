import type { JobType } from "@maludb-agent/job-contracts";

import type { Queryable } from "../pool.js";
import type { JobRunRow, JobRunStatus } from "../types.js";

const COLS = `id, tenant_id AS "tenantId", job_type AS "jobType", status, trigger,
  policy_version AS "policyVersion", inputs, outputs, error, attempts,
  bull_job_id AS "bullJobId", started_at AS "startedAt", finished_at AS "finishedAt",
  created_at AS "createdAt"`;

export interface CreateJobRunInput {
  tenantId: string;
  jobType: JobType;
  status?: JobRunStatus;
  trigger?: string;
  policyVersion?: number;
  inputs?: unknown;
  bullJobId?: string;
}

export async function createJobRun(db: Queryable, r: CreateJobRunInput): Promise<JobRunRow> {
  const res = await db.query<JobRunRow>(
    `INSERT INTO job_runs (tenant_id, job_type, status, trigger, policy_version, inputs, bull_job_id, started_at)
     VALUES ($1, $2, COALESCE($3, 'running'), $4, $5, $6::jsonb, $7, now())
     RETURNING ${COLS}`,
    [
      r.tenantId,
      r.jobType,
      r.status ?? null,
      r.trigger ?? null,
      r.policyVersion ?? null,
      JSON.stringify(r.inputs ?? null),
      r.bullJobId ?? null,
    ],
  );
  return res.rows[0]!;
}

export interface CompleteJobRunInput {
  status: JobRunStatus;
  outputs?: unknown;
  error?: string;
  attempts?: number;
}

export async function completeJobRun(
  db: Queryable,
  id: string,
  c: CompleteJobRunInput,
): Promise<void> {
  await db.query(
    `UPDATE job_runs
     SET status = $2, outputs = $3::jsonb, error = $4,
         attempts = COALESCE($5, attempts), finished_at = now()
     WHERE id = $1`,
    [id, c.status, JSON.stringify(c.outputs ?? null), c.error ?? null, c.attempts ?? null],
  );
}

export async function getJobRun(db: Queryable, id: string): Promise<JobRunRow | null> {
  const res = await db.query<JobRunRow>(`SELECT ${COLS} FROM job_runs WHERE id = $1`, [id]);
  return res.rows[0] ?? null;
}

export async function listJobRuns(
  db: Queryable,
  opts: { tenantId?: string; jobType?: JobType; limit?: number } = {},
): Promise<JobRunRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  if (opts.tenantId !== undefined) {
    values.push(opts.tenantId);
    where.push(`tenant_id = $${values.length}`);
  }
  if (opts.jobType !== undefined) {
    values.push(opts.jobType);
    where.push(`job_type = $${values.length}`);
  }
  values.push(opts.limit ?? 50);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const res = await db.query<JobRunRow>(
    `SELECT ${COLS} FROM job_runs ${clause} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return res.rows;
}
