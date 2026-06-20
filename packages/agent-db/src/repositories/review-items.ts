import type { Queryable } from "../pool.js";
import type { ReviewItemRow, ReviewKind, ReviewStatus } from "../types.js";

const COLS = `id, tenant_id AS "tenantId", kind, status, dedup_key AS "dedupKey",
  payload, provenance, created_at AS "createdAt", resolved_at AS "resolvedAt"`;

export interface CreateReviewItemInput {
  tenantId: string;
  kind: ReviewKind;
  payload: unknown;
  provenance?: unknown;
  /** Stable key for idempotency, e.g. tenant+subject+verb+predicate (worker-design §6). */
  dedupKey?: string;
}

/** Insert a review item; if a dedup key is given, re-running updates the existing item. */
export async function createReviewItem(
  db: Queryable,
  r: CreateReviewItemInput,
): Promise<ReviewItemRow> {
  const res = await db.query<ReviewItemRow>(
    `INSERT INTO review_items (tenant_id, kind, payload, provenance, dedup_key)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (tenant_id, dedup_key) WHERE dedup_key IS NOT NULL
       DO UPDATE SET payload = EXCLUDED.payload, provenance = EXCLUDED.provenance
     RETURNING ${COLS}`,
    [
      r.tenantId,
      r.kind,
      JSON.stringify(r.payload ?? null),
      JSON.stringify(r.provenance ?? null),
      r.dedupKey ?? null,
    ],
  );
  return res.rows[0]!;
}

export async function resolveReviewItem(
  db: Queryable,
  id: string,
  decision: Exclude<ReviewStatus, "open">,
): Promise<void> {
  await db.query(`UPDATE review_items SET status = $2, resolved_at = now() WHERE id = $1`, [
    id,
    decision,
  ]);
}

export async function listReviewItems(
  db: Queryable,
  opts: { tenantId?: string; status?: ReviewStatus; kind?: ReviewKind; limit?: number } = {},
): Promise<ReviewItemRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of [
    ["tenant_id", opts.tenantId],
    ["status", opts.status],
    ["kind", opts.kind],
  ] as const) {
    if (val !== undefined) {
      values.push(val);
      where.push(`${col} = $${values.length}`);
    }
  }
  values.push(opts.limit ?? 50);
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const res = await db.query<ReviewItemRow>(
    `SELECT ${COLS} FROM review_items ${clause} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return res.rows;
}
