/** Error types raised by the MaluDB client. Workers branch on these to classify outcomes. */

export class MaludbError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A non-2xx response (other than 501). Carries the parsed {error:{code,message}} envelope. */
export class MaludbHttpError extends MaludbError {
  constructor(
    readonly status: number,
    readonly code: string,
    apiMessage: string,
    readonly body?: unknown,
  ) {
    super(`MaluDB API error ${status} (${code}): ${apiMessage}`);
  }
}

/**
 * The endpoint returned HTTP 501 — the tenant's MaluDB Core is too old, or the endpoint
 * is not deployed yet (see docs/api-contract.md Part C). Treated as "capability
 * unavailable", not a job failure: the worker records the run as skipped.
 */
export class CapabilityUnavailableError extends MaludbError {
  readonly status = 501 as const;
  constructor(
    readonly endpoint: string,
    readonly code = "not_implemented",
  ) {
    super(`MaluDB capability unavailable: ${endpoint} returned 501`);
  }
}

/** The request exceeded the configured per-request timeout (after exhausting retries). */
export class MaludbTimeoutError extends MaludbError {
  constructor(
    readonly endpoint: string,
    readonly timeoutMs: number,
  ) {
    super(`MaluDB request timed out after ${timeoutMs}ms: ${endpoint}`);
  }
}

/** A transport-level failure (DNS, connection reset, etc.) after exhausting retries. */
export class MaludbNetworkError extends MaludbError {
  constructor(
    readonly endpoint: string,
    options?: ErrorOptions,
  ) {
    super(`MaluDB network error: ${endpoint}`, options);
  }
}

/** Narrow an unknown error to a 501 capability-unavailable outcome. */
export function isCapabilityUnavailable(err: unknown): err is CapabilityUnavailableError {
  return err instanceof CapabilityUnavailableError;
}
