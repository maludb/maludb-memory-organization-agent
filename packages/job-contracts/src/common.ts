import { z } from "zod";

import { JOB_TYPES } from "./job-types.js";

/** Zod enum of the canonical job-type names. */
export const jobTypeSchema = z.enum(JOB_TYPES);

/** How a job came to be enqueued — recorded for traceability. */
export const triggerSchema = z.enum(["schedule", "manual", "policy.evaluate"]);
export type Trigger = z.infer<typeof triggerSchema>;

/**
 * Fields present on every job payload. The worker resolves the tenant's token and
 * effective policy from `tenantId` (see docs/worker-design.md "Conventions"). Job
 * parameters are derived by a schedule or by policy.evaluate and stored on the
 * BullMQ job; the queue/job name carries the job type, so it is not repeated here.
 */
export const jobMetaBase = z.object({
  tenantId: z.string().min(1),
  trigger: triggerSchema.default("schedule"),
  /** Policy version the params were derived from; recorded on the run. */
  policyVersion: z.number().int().positive().optional(),
});
export type JobMeta = z.infer<typeof jobMetaBase>;

/** Why a batch-looping sweep stopped. */
export const stoppedReasonSchema = z.enum([
  "drained", // claimed === 0
  "max_batches", // hit maxBatchesPerRun
  "capability_unavailable", // endpoint returned 501 for this tenant
  "error", // aborted on a non-retryable error
]);
export type StoppedReason = z.infer<typeof stoppedReasonSchema>;

/**
 * Shared shape of the three "drain one batch" sweeps (memory reindex, skills reindex,
 * embeddings). Each adds its own per-item totals on top (see docs/api-contract.md A.2).
 */
export const sweepResultBase = z.object({
  batches: z.number().int().nonnegative(),
  claimedTotal: z.number().int().nonnegative(),
  errors: z.array(z.unknown()).default([]),
  capabilityUnavailable: z.boolean().default(false),
  stoppedReason: stoppedReasonSchema.optional(),
});
