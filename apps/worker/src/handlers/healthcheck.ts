import { updateTenantHealth } from "@maludb-agent/agent-db";
import type { JobResult } from "@maludb-agent/job-contracts";
import { isCapabilityUnavailable } from "@maludb-agent/maludb-client";

import type { JobContext } from "../context.js";
import { errMessage } from "./util.js";

/**
 * Confirm a tenant is reachable and configured, and persist the result on the tenant row.
 * The full capability probe (api-contract Part C) lands with the new API endpoints; for
 * now we verify /health and /v1/memory/config.
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

  const capabilities: Record<string, boolean> = {};
  const overall = healthy && configOk;
  await updateTenantHealth(ctx.db, ctx.tenant.id, {
    healthy: overall,
    capabilities,
    health: { healthy, configOk, warnings },
  });

  return { healthy: overall, configOk, capabilities, warnings };
}
