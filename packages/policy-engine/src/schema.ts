import { z } from "zod";

/**
 * Policy schema — the executable form of docs/policies.md and the single source of
 * truth for policy shape. Scaffold stub: only the always-required top-level fields are
 * enforced for now; `.passthrough()` keeps the rest of the documented sections valid
 * while the full schema is filled in (policy-engine task). Replace passthrough with the
 * complete section schemas (priorities, schedules, reindex, embeddings, contradictions,
 * consolidation, lifecycle, cost_controls, models, review).
 */
export const policySchema = z
  .object({
    tenant: z.string().min(1),
    memory_policy_version: z.number().int().positive(),
  })
  .passthrough();

export type Policy = z.infer<typeof policySchema>;

/** Parse + validate a raw (already YAML-decoded) policy object. Throws on invalid input. */
export function parsePolicy(raw: unknown): Policy {
  return policySchema.parse(raw);
}
