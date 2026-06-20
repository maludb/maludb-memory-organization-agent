import type { JobResult } from "@maludb-agent/job-contracts";
import { planScheduledJobs } from "@maludb-agent/policy-engine";

import type { JobContext } from "../context.js";
import { resolvePolicyForTenant } from "../policy.js";

/**
 * Resolve the tenant's effective policy and report the plan. Execution is driven directly
 * by repeatable schedules (see scheduler.ts), so this handler is advisory — it surfaces
 * what *would* run for observability and does not enqueue (avoiding duplicate runs).
 * Candidate scoring over the API lands with the scan workers.
 */
export async function policyEvaluate(ctx: JobContext): Promise<JobResult<"policy.evaluate">> {
  const policy = await resolvePolicyForTenant(ctx.db, ctx.tenant.id);
  const plannedJobs = planScheduledJobs(policy);
  ctx.log.info(
    { tenantId: ctx.tenant.id, planned: plannedJobs.map((j) => j.jobType) },
    "policy evaluated",
  );
  return { candidatesConsidered: 0, plannedJobs };
}
