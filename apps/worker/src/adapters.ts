import { createAdapter, type ModelAdapter } from "@maludb-agent/model-adapters";
import type { Policy } from "@maludb-agent/policy-engine";

/** Build the default model adapter for a tenant policy (docs/policies.md §3.10). */
export function adapterForPolicy(policy: Policy, env: NodeJS.ProcessEnv): ModelAdapter {
  return createAdapter(policy.models.default, env);
}
