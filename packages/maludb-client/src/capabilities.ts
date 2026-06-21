/**
 * Capability discovery (docs/api-contract.md Part C, architecture.md §8). The agent does
 * not assume the newer maintenance endpoints exist — some are PRs in flight across a
 * separate repo (ADR-0002). On `tenant.healthcheck` it reads the tenant's `/openapi.json`
 * and derives which capabilities are present; workers and the review queue gate on the
 * result so a two-repo rollout lights up per environment without redeploying the agent.
 */

/** Capability names the agent gates on, each mapped to the endpoint that backs it. */
export const CAPABILITY_ENDPOINTS = {
  "memory.reindex": { method: "POST", path: "/v1/memory/reindex/run" },
  "skills.reindex": { method: "POST", path: "/v1/skills/reindex/run" },
  "embeddings.drain": { method: "POST", path: "/v1/memory/embeddings/run" },
  "memory.notes": { method: "GET", path: "/v1/memory/notes" },
  "statements.list": { method: "GET", path: "/v1/statements" },
  "statements.close": { method: "PATCH", path: "/v1/statements/{id}" },
  "subjects.list": { method: "GET", path: "/v1/subjects" },
  "memory.consolidate": { method: "POST", path: "/v1/memory/consolidate" },
  "memory.lifecycle": { method: "POST", path: "/v1/memory/lifecycle" },
  "memory.score": { method: "POST", path: "/v1/memory/score" },
  "memory.staleness": { method: "POST", path: "/v1/memory/staleness" },
  "memory.reinforcement": { method: "POST", path: "/v1/memory/reinforcement" },
  "memory.retentionCandidates": { method: "GET", path: "/v1/memory/retention-candidates" },
} as const satisfies Record<string, { method: string; path: string }>;

export type CapabilityName = keyof typeof CAPABILITY_ENDPOINTS;

/** The slice of an OpenAPI document we read — only `paths` matters for discovery. */
export interface OpenApiDoc {
  paths?: Record<string, Record<string, unknown> | null>;
  [key: string]: unknown;
}

/** Collapse path templating so parameter names don't matter: `/x/{statement_id}` → `/x/{}`. */
const normalize = (p: string): string => p.replace(/\{[^}]+\}/g, "{}");

/**
 * Derive a COMPLETE capability map from an OpenAPI document: every known capability →
 * whether its (method, path) is present. A complete map matters for `capabilityState`'s
 * three-valued logic — an empty map means "never probed", not "everything absent".
 */
export function deriveCapabilities(doc: OpenApiDoc | null | undefined): Record<CapabilityName, boolean> {
  const entries = Object.entries(doc?.paths ?? {});
  const out = {} as Record<CapabilityName, boolean>;
  for (const cap of Object.keys(CAPABILITY_ENDPOINTS) as CapabilityName[]) {
    const { method, path } = CAPABILITY_ENDPOINTS[cap];
    const want = normalize(path);
    const verb = method.toLowerCase();
    out[cap] = entries.some(
      ([p, ops]) => normalize(p) === want && !!ops && typeof ops === "object" && verb in ops,
    );
  }
  return out;
}

/**
 * Read a capability from a persisted map with three-valued logic: `true`/`false` once the
 * tenant has been probed, `undefined` when it hasn't (empty map). Callers treat `undefined`
 * as "proceed and let runtime 501 handling decide" and only hard-block on an explicit
 * `false`, so an un-probed tenant is never accidentally locked out.
 */
export function capabilityState(
  map: Record<string, boolean> | null | undefined,
  cap: CapabilityName,
): boolean | undefined {
  if (!map || Object.keys(map).length === 0) return undefined;
  return map[cap];
}
