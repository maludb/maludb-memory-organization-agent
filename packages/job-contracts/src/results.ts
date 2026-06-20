import { z } from "zod";

import { jobTypeSchema, sweepResultBase } from "./common.js";

/** Job result schemas (outputs). Persisted on the job_runs row (docs/architecture.md §7). */

// tenant.healthcheck
export const tenantHealthcheckResult = z.object({
  healthy: z.boolean(),
  configOk: z.boolean(),
  /** Per-tenant capability map from the discovery probe (docs/api-contract.md Part C). */
  capabilities: z.record(z.string(), z.boolean()).default({}),
  warnings: z.array(z.string()).default([]),
});

// policy.evaluate
export const plannedJobSchema = z.object({
  jobType: jobTypeSchema,
  params: z.record(z.string(), z.unknown()).default({}),
});
export type PlannedJob = z.infer<typeof plannedJobSchema>;

export const policyEvaluateResult = z.object({
  candidatesConsidered: z.number().int().nonnegative().default(0),
  plannedJobs: z.array(plannedJobSchema).default([]),
});

// memory.reindex.sweep
export const memoryReindexSweepResult = sweepResultBase.extend({
  reindexedTotal: z.number().int().nonnegative(),
  skippedTotal: z.number().int().nonnegative().default(0),
});

// skills.reindex.sweep
export const skillsReindexSweepResult = sweepResultBase.extend({
  reindexedTotal: z.number().int().nonnegative(),
});

// embeddings.drain
export const embeddingsDrainResult = sweepResultBase.extend({
  embeddedTotal: z.number().int().nonnegative(),
});

// memory.contradiction.scan
export const memoryContradictionScanResult = z.object({
  subjectsExamined: z.number().int().nonnegative(),
  contradictionsFound: z.number().int().nonnegative(),
  reviewItemsCreated: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative().default(0),
  tokens: z.number().int().nonnegative().default(0),
  capabilityUnavailable: z.boolean().default(false),
});

// memory.consolidation.scan
export const memoryConsolidationScanResult = z.object({
  clustersFound: z.number().int().nonnegative(),
  consolidationsProposed: z.number().int().nonnegative(),
  reviewItemsCreated: z.number().int().nonnegative(),
  capabilityUnavailable: z.boolean().default(false),
});
