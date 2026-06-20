import { policySchema, type Policy } from "./schema.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `override` onto `base`. Plain objects merge recursively; arrays and scalars
 * are replaced wholesale by the override (so e.g. a tenant's `domains` list replaces the
 * default's rather than concatenating). `undefined` override values leave the base value
 * intact; `null` replaces.
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
  }
  return override === undefined ? base : override;
}

/**
 * Resolve the effective policy for a tenant: a sparse override deep-merged onto a complete
 * default, re-validated against the full schema (docs/policies.md §5). The `defaultPolicy`
 * must already be a parsed, complete policy.
 */
export function resolveEffectivePolicy(defaultPolicy: Policy, override?: unknown): Policy {
  if (override === undefined || override === null) return defaultPolicy;
  return policySchema.parse(deepMerge(defaultPolicy, override));
}
