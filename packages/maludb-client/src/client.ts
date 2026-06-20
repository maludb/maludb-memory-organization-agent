import type { MaludbClientConfig, Statement, SweepResult } from "./types.js";

/**
 * Typed client for the MaluDB public API — the ONLY way this service reaches MaluDB
 * (see docs/decisions.md ADR-0001). Responsibilities the reference Rust CLI lacks
 * (docs/architecture.md §5):
 *   - Bearer auth on every call (token = tenant; no tenant/namespace header).
 *   - Per-request timeout + bounded exponential backoff on transient failures.
 *   - Parse the {"error":{"code","message"}} envelope.
 *   - Treat HTTP 501 as "capability unavailable" rather than a hard failure.
 *
 * Scaffold stub: method signatures and docs are stable; bodies are implemented in the
 * maludb-client task. Endpoint shapes are specified in docs/api-contract.md.
 */
export class MaludbClient {
  constructor(private readonly config: MaludbClientConfig) {}

  /** GET /health — unauthenticated liveness. */
  health(): Promise<{ status: string }> {
    return this.todo("GET /health");
  }

  /** GET /v1/memory/config?namespace= */
  getMemoryConfig(): Promise<unknown> {
    return this.todo("GET /v1/memory/config");
  }

  /** POST /v1/memory/reindex/run — loop until claimed === 0 (see docs/worker-design.md §3). */
  runMemoryReindex(_params: { limit: number; maxAge: string; sourceType?: string }): Promise<SweepResult> {
    return this.todo("POST /v1/memory/reindex/run");
  }

  /** POST /v1/skills/reindex/run */
  runSkillsReindex(_params: { limit: number; maxAge: string }): Promise<SweepResult> {
    return this.todo("POST /v1/skills/reindex/run");
  }

  /** POST /v1/memory/embeddings/run */
  runEmbeddingsDrain(_params: { limit: number; kinds?: string[] }): Promise<SweepResult> {
    return this.todo("POST /v1/memory/embeddings/run");
  }

  /** GET /v1/statements — inputs to contradiction detection. */
  listStatements(_filter: { subjectId?: number; verbId?: number; limit?: number }): Promise<Statement[]> {
    return this.todo("GET /v1/statements");
  }

  private todo(endpoint: string): never {
    throw new Error(`MaludbClient: ${endpoint} not implemented yet (baseUrl=${this.config.baseUrl})`);
  }
}
