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
  /** Per-request timeout in ms. The reference CLI has none; we add one. */
  timeoutMs?: number;
  /** Max retry attempts for transient failures (timeouts / 5xx). */
  maxRetries?: number;
}

/** Structured error envelope returned by the API: {"error":{"code","message"}}. */
export interface MaludbApiError {
  code: string;
  message: string;
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
