import type { z } from "zod";

import { type JobType } from "./job-types.js";
import * as payloads from "./payloads.js";
import * as results from "./results.js";

/** A job type's input + output schemas. */
export interface JobContract {
  payload: z.ZodTypeAny;
  result: z.ZodTypeAny;
}

/**
 * The contract registry: one payload + result schema per job type. This is the single
 * source of truth shared by the control API (validate at enqueue) and the worker
 * (validate at dequeue). `satisfies` enforces that every JobType has a contract while
 * preserving each schema's specific type for inference below.
 */
export const jobContracts = {
  "tenant.healthcheck": {
    payload: payloads.tenantHealthcheckPayload,
    result: results.tenantHealthcheckResult,
  },
  "policy.evaluate": {
    payload: payloads.policyEvaluatePayload,
    result: results.policyEvaluateResult,
  },
  "memory.reindex.sweep": {
    payload: payloads.memoryReindexSweepPayload,
    result: results.memoryReindexSweepResult,
  },
  "skills.reindex.sweep": {
    payload: payloads.skillsReindexSweepPayload,
    result: results.skillsReindexSweepResult,
  },
  "embeddings.drain": {
    payload: payloads.embeddingsDrainPayload,
    result: results.embeddingsDrainResult,
  },
  "memory.contradiction.scan": {
    payload: payloads.memoryContradictionScanPayload,
    result: results.memoryContradictionScanResult,
  },
  "memory.consolidation.scan": {
    payload: payloads.memoryConsolidationScanPayload,
    result: results.memoryConsolidationScanResult,
  },
} satisfies Record<JobType, JobContract>;

/** Validated payload type for a given job type (with defaults applied). */
export type JobPayload<T extends JobType> = z.infer<(typeof jobContracts)[T]["payload"]>;
/** Validated result type for a given job type. */
export type JobResult<T extends JobType> = z.infer<(typeof jobContracts)[T]["result"]>;

/** Parse + validate a job payload, applying schema defaults. Throws on invalid input. */
export function parseJobPayload<T extends JobType>(jobType: T, data: unknown): JobPayload<T> {
  return jobContracts[jobType].payload.parse(data) as JobPayload<T>;
}

/** Parse + validate a job result. Throws on invalid input. */
export function parseJobResult<T extends JobType>(jobType: T, data: unknown): JobResult<T> {
  return jobContracts[jobType].result.parse(data) as JobResult<T>;
}

/** Non-throwing payload validation (returns Zod's SafeParse result). */
export function safeParseJobPayload<T extends JobType>(jobType: T, data: unknown) {
  return jobContracts[jobType].payload.safeParse(data);
}

/** Non-throwing result validation (returns Zod's SafeParse result). */
export function safeParseJobResult<T extends JobType>(jobType: T, data: unknown) {
  return jobContracts[jobType].result.safeParse(data);
}
