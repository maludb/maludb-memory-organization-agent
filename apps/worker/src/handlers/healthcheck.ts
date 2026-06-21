import { updateTenantHealth } from "@maludb-agent/agent-db";
import type { JobResult } from "@maludb-agent/job-contracts";
import { deriveCapabilities, isCapabilityUnavailable } from "@maludb-agent/maludb-client";

import type { JobContext } from "../context.js";
import { errMessage } from "./util.js";

/**
 * Confirm a tenant is reachable and configured, probe which API capabilities it exposes,
 * and persist all of it on the tenant row. The capability map (api-contract Part C) is
 * derived from the tenant's /openapi.json so a two-repo rollout lights up per environment
 * without redeploying the agent; workers and the review queue gate on it.
 */
export async function tenantHealthcheck(ctx: JobContext): Promise<JobResult<"tenant.healthcheck">> {
  const warnings: string[] = [];
  let healthy = false;
  let configOk = false;

  try {
    const h = await ctx.client.health();
    healthy = Boolean(h.status);
  } catch (err) {
    warnings.push(`health failed: ${errMessage(err)}`);
  }

  try {
    await ctx.client.getMemoryConfig();
    configOk = true;
  } catch (err) {
    warnings.push(
      isCapabilityUnavailable(err)
        ? "memory config capability unavailable"
        : `config failed: ${errMessage(err)}`,
    );
  }

  // Capability discovery: an empty map means "not probed" (left intact on failure), which
  // callers treat as unknown rather than "all absent" — see capabilityState.
  let capabilities: Record<string, boolean> = {};
  try {
    capabilities = deriveCapabilities(await ctx.client.getOpenApi());
  } catch (err) {
    warnings.push(`capability probe failed: ${errMessage(err)}`);
  }

  const overall = healthy && configOk;
  await updateTenantHealth(ctx.db, ctx.tenant.id, {
    healthy: overall,
    capabilities,
    health: { healthy, configOk, warnings },
  });

  return { healthy: overall, configOk, capabilities, warnings };
}
