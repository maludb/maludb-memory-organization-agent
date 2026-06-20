import type { JobType } from "@maludb-agent/job-contracts";

import type { Policy } from "./schema.js";

/** A unit of work the evaluator decides to enqueue (see docs/worker-design.md §2). */
export interface PlannedJob {
  jobType: JobType;
  params: Record<string, unknown>;
}

/**
 * Turn an effective policy + current tenant state into prioritized, scheduled work.
 * Scaffold stub — implement in the policy-engine task. Will use priorityScore() over
 * candidates enumerated from the MaluDB API to choose priority tiers and parameters.
 */
export function evaluatePolicy(_policy: Policy): PlannedJob[] {
  throw new Error("evaluatePolicy not implemented yet");
}
