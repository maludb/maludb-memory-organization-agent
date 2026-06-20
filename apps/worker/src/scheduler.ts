import { listTenants } from "@maludb-agent/agent-db";
import { type JobType } from "@maludb-agent/job-contracts";
import { planScheduledJobs, type Policy } from "@maludb-agent/policy-engine";

import type { WorkerDeps } from "./context.js";
import { resolvePolicyForTenant } from "./policy.js";

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parse a duration like "5m", "10s", "2h" into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`invalid duration: ${value}`);
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}

export type RepeatSpec = { pattern: string } | { every: number };

export interface RepeatableSpec {
  jobType: JobType;
  /** Per-tenant job name so repeatables don't collide across tenants on a shared queue. */
  name: string;
  payload: Record<string, unknown>;
  repeat: RepeatSpec;
}

/**
 * Compute the repeatable jobs for a tenant from its policy (pure; unit-tested). Schedules
 * drive execution directly: healthcheck + policy.evaluate from their schedule entries, and
 * each enabled sweep/scan from planScheduledJobs with policy-derived params.
 */
export function planRepeatables(tenantId: string, policy: Policy): RepeatableSpec[] {
  const specs: RepeatableSpec[] = [];

  const add = (jobType: JobType, params: Record<string, unknown>): void => {
    const entry = policy.schedules[jobType];
    if (!entry || entry.enabled === false) return;
    const repeat: RepeatSpec | null = entry.cron
      ? { pattern: entry.cron }
      : entry.every
        ? { every: parseDuration(entry.every) }
        : null;
    if (!repeat) return;
    specs.push({
      jobType,
      name: `${tenantId}:${jobType}`,
      payload: { tenantId, trigger: "schedule", ...params },
      repeat,
    });
  };

  add("tenant.healthcheck", {});
  add("policy.evaluate", {});
  for (const planned of planScheduledJobs(policy)) add(planned.jobType, planned.params);

  return specs;
}

/**
 * Register repeatable jobs for every enabled tenant. Idempotent per (name, repeat): BullMQ
 * upserts the repeatable. Removing obsolete repeatables on cadence change is a TODO.
 */
export async function applySchedules(deps: WorkerDeps): Promise<number> {
  const tenants = await listTenants(deps.pool, { enabledOnly: true });
  let count = 0;
  for (const tenant of tenants) {
    const policy = await resolvePolicyForTenant(deps.pool, tenant.id);
    for (const spec of planRepeatables(tenant.id, policy)) {
      await deps.queues[spec.jobType].add(spec.name, spec.payload, { repeat: spec.repeat });
      count += 1;
    }
  }
  deps.log.info({ tenants: tenants.length, repeatables: count }, "schedules applied");
  return count;
}
