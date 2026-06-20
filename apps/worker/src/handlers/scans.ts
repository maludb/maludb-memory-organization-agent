import type { JobResult } from "@maludb-agent/job-contracts";

import type { JobContext } from "../context.js";

/**
 * Contradiction detection (ADR-0005) is the next intelligence worker. It needs the new
 * contradiction/review API endpoints (api-contract Part B) and model-adapter calls; until
 * those land it reports capabilityUnavailable so the run is recorded as skipped.
 */
export async function contradictionScan(
  ctx: JobContext,
): Promise<JobResult<"memory.contradiction.scan">> {
  ctx.log.warn(
    { tenantId: ctx.tenant.id },
    "contradiction scan not yet implemented; skipping (needs contradiction/review API)",
  );
  return {
    subjectsExamined: 0,
    contradictionsFound: 0,
    reviewItemsCreated: 0,
    modelCalls: 0,
    tokens: 0,
    capabilityUnavailable: true,
  };
}

/** Consolidation (phase 2) needs POST /v1/memory/consolidate (api-contract B.4). */
export async function consolidationScan(
  ctx: JobContext,
): Promise<JobResult<"memory.consolidation.scan">> {
  ctx.log.warn(
    { tenantId: ctx.tenant.id },
    "consolidation scan not yet implemented; skipping (needs consolidate API)",
  );
  return {
    clustersFound: 0,
    consolidationsProposed: 0,
    reviewItemsCreated: 0,
    capabilityUnavailable: true,
  };
}
