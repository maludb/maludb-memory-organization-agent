import { z } from "zod";

import { jobMetaBase } from "./common.js";

/**
 * Job payload schemas (inputs). Defaults mirror the policy defaults documented in
 * docs/policies.md so a payload can be enqueued with just a tenantId during testing.
 * Limits match the API caps in docs/api-contract.md A.2.
 */

// tenant.healthcheck — no parameters beyond the meta base.
export const tenantHealthcheckPayload = jobMetaBase;

// policy.evaluate — no parameters; it reads tenant state and decides what to enqueue.
export const policyEvaluatePayload = jobMetaBase;

// memory.reindex.sweep → POST /v1/memory/reindex/run (looped).
export const memoryReindexSweepPayload = jobMetaBase.extend({
  limit: z.number().int().positive().max(200).default(32),
  /** Postgres interval string, e.g. "30 days" (passed through to the endpoint). */
  maxAge: z.string().min(1).default("30 days"),
  sourceType: z.string().optional(),
  maxBatchesPerRun: z.number().int().positive().default(50),
});

// skills.reindex.sweep → POST /v1/skills/reindex/run (looped).
export const skillsReindexSweepPayload = jobMetaBase.extend({
  limit: z.number().int().positive().max(200).default(32),
  maxAge: z.string().min(1).default("30 days"),
  maxBatchesPerRun: z.number().int().positive().default(20),
});

// embeddings.drain → POST /v1/memory/embeddings/run (looped).
export const embeddingsDrainPayload = jobMetaBase.extend({
  limit: z.number().int().positive().max(512).default(64),
  /** Entity-card kinds to drain, e.g. ["subject","verb"]; omit for all. */
  kinds: z.array(z.string()).optional(),
  maxBatchesPerRun: z.number().int().positive().default(50),
});

// memory.contradiction.scan — first intelligence worker (docs/decisions.md ADR-0005).
export const memoryContradictionScanPayload = jobMetaBase.extend({
  maxSubjectsPerRun: z.number().int().positive().default(200),
  minConfidenceToFlag: z.number().min(0).max(1).default(0.6),
  groupBy: z.array(z.string()).default(["subject", "verb", "predicate"]),
  /** If true (NOT default), the agent may retract the losing edge; otherwise review only. */
  autoResolve: z.boolean().default(false),
  createReviewItems: z.boolean().default(true),
});

// memory.consolidation.scan — phase 2, endpoint-gated (docs/api-contract.md B.4).
export const memoryConsolidationScanPayload = jobMetaBase.extend({
  minRelatedMemories: z.number().int().positive().default(4),
  requireReview: z.boolean().default(true),
});
