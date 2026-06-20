/** A fetch-compatible function. Injectable so the client is unit-testable without a network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Per-tenant connection config. The bearer token IS the tenant selector — there is no
 * tenant or namespace header (see docs/decisions.md ADR-0004, docs/api-contract.md).
 */
export interface MaludbClientConfig {
  /** Tenant API base URL, e.g. https://api.maludb.org */
  baseUrl: string;
  /** Bearer token ("malu_..."), resolved by the caller from a secret reference. */
  token: string;
  /** Memory namespace (body/query field, default "default"); not a header. */
  namespace?: string;
  /** Per-request timeout in ms (default 30000). The reference CLI has none; we add one. */
  timeoutMs?: number;
  /** Max retries for transient failures — timeouts / network / 5xx / 429 (default 3). */
  maxRetries?: number;
  /** Base backoff in ms; doubles per attempt with full jitter (default 200). */
  retryBaseMs?: number;
  /** Backoff ceiling in ms (default 10000). */
  retryMaxMs?: number;
  /** Override fetch (for tests). Defaults to the global fetch. */
  fetch?: FetchLike;
}

/** Structured error envelope returned by the API: {"error":{"code","message"}}. */
export interface MaludbApiError {
  code: string;
  message: string;
}

export interface HealthResponse {
  status: string;
  [key: string]: unknown;
}

export interface MemoryConfigResponse {
  namespace: string;
  config: unknown;
}

/** Shared shape of the three synchronous "drain one batch" sweep endpoints. */
export interface SweepResult {
  claimed: number;
  errors: unknown[];
  [key: string]: unknown;
}

/** A single SVO statement (claim) as returned by GET /v1/statements. */
export interface Statement {
  id: number;
  subject_kind: string;
  subject_id: number;
  verb_id: number;
  object_kind: string | null;
  object_id: number | null;
  predicate_id: number | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  provenance: string | null;
  source_package_id: number | null;
  created_at: string;
}

/** A subject (entity) as returned by GET /v1/subjects. */
export interface Subject {
  id: number;
  label: string;
  type: string | null;
  description: string | null;
}

/** A note/memory as returned by GET /v1/memory/notes (id is the malu$memory id). */
export interface MemoryNote {
  id: number;
  title: string | null;
  source_type: string | null;
  snippet: string | null;
  created_at: string;
}

/** Result of POST /v1/memory/consolidate. */
export interface ConsolidateResult {
  consolidated_into_memory_id: number;
}
