import { getLatestPolicy, type Queryable } from "@maludb-agent/agent-db";
import { parsePolicy, resolveEffectivePolicy, type Policy } from "@maludb-agent/policy-engine";

/**
 * Resolve a tenant's effective policy: the 'default' policy (if stored) as the base, with
 * the tenant's own policy deep-merged on top (docs/policies.md §5). Falls back to schema
 * defaults when nothing is stored yet.
 */
export async function resolvePolicyForTenant(db: Queryable, tenantId: string): Promise<Policy> {
  const defaultRow = await getLatestPolicy(db, "default");
  const base = defaultRow
    ? parsePolicy(defaultRow.document)
    : parsePolicy({ tenant: tenantId, memory_policy_version: 1 });

  if (tenantId === "default") return base;
  const tenantRow = await getLatestPolicy(db, tenantId);
  return tenantRow ? resolveEffectivePolicy(base, tenantRow.document) : base;
}
