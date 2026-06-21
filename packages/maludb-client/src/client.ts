import {
  CapabilityUnavailableError,
  MaludbError,
  MaludbHttpError,
  MaludbNetworkError,
  MaludbTimeoutError,
} from "./errors.js";
import type { OpenApiDoc } from "./capabilities.js";
import type {
  ConsolidateResult,
  FetchLike,
  HealthResponse,
  LifecycleResult,
  MaludbClientConfig,
  MemoryConfigResponse,
  MemoryNote,
  ScoreResult,
  Statement,
  Subject,
  SweepResult,
} from "./types.js";

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Query = Record<string, string | number | undefined>;

interface RequestOptions {
  method: Method;
  path: string;
  query?: Query;
  body?: unknown;
  /** Send the Authorization header (default true). /health is the only auth=false call. */
  auth?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 200;
const DEFAULT_RETRY_MAX_MS = 10_000;

/**
 * Typed client for the MaluDB public API — the ONLY way this service reaches MaluDB
 * (docs/decisions.md ADR-0001). Adds what the reference Rust CLI lacks
 * (docs/architecture.md §5): per-request timeout, bounded exponential backoff with
 * jitter on transient failures, {"error":{"code","message"}} envelope parsing, and
 * HTTP 501 handling as "capability unavailable". All exposed operations are idempotent,
 * so transient failures are safe to retry.
 */
export class MaludbClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: MaludbClientConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  // --- endpoints ---------------------------------------------------------------

  /** GET /health — unauthenticated liveness. */
  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>({ method: "GET", path: "/health", auth: false });
  }

  /** GET /openapi.json — capability discovery (docs/api-contract.md Part C). Unauthenticated. */
  getOpenApi(): Promise<OpenApiDoc> {
    return this.request<OpenApiDoc>({ method: "GET", path: "/openapi.json", auth: false });
  }

  /** GET /v1/memory/config?namespace= */
  getMemoryConfig(): Promise<MemoryConfigResponse> {
    return this.request<MemoryConfigResponse>({
      method: "GET",
      path: "/v1/memory/config",
      query: { namespace: this.namespace },
    });
  }

  /** POST /v1/memory/reindex/run — one batch (the worker loops; see docs/worker-design.md §3). */
  runMemoryReindex(params: { limit: number; maxAge: string; sourceType?: string }): Promise<SweepResult> {
    return this.request<SweepResult>({
      method: "POST",
      path: "/v1/memory/reindex/run",
      query: { limit: params.limit, max_age: params.maxAge, source_type: params.sourceType },
    });
  }

  /** POST /v1/skills/reindex/run — one batch. */
  runSkillsReindex(params: { limit: number; maxAge: string }): Promise<SweepResult> {
    return this.request<SweepResult>({
      method: "POST",
      path: "/v1/skills/reindex/run",
      query: { limit: params.limit, max_age: params.maxAge },
    });
  }

  /** POST /v1/memory/embeddings/run — one batch. */
  runEmbeddingsDrain(params: { limit: number; kinds?: string[] }): Promise<SweepResult> {
    return this.request<SweepResult>({
      method: "POST",
      path: "/v1/memory/embeddings/run",
      query: { limit: params.limit, kinds: params.kinds?.join(",") },
    });
  }

  /** GET /v1/statements — inputs to contradiction detection. */
  async listStatements(filter: {
    subjectId?: number;
    verbId?: number;
    subjectKind?: string;
    provenance?: string;
    limit?: number;
  }): Promise<Statement[]> {
    const res = await this.request<{ statements?: Statement[] }>({
      method: "GET",
      path: "/v1/statements",
      query: {
        subject_id: filter.subjectId,
        verb_id: filter.verbId,
        subject_kind: filter.subjectKind,
        provenance: filter.provenance,
        limit: filter.limit,
      },
    });
    return res.statements ?? [];
  }

  /** GET /v1/subjects — enumerate candidate entities. */
  async listSubjects(filter: { q?: string; limit?: number } = {}): Promise<Subject[]> {
    const res = await this.request<{ subjects?: Subject[] }>({
      method: "GET",
      path: "/v1/subjects",
      query: { q: filter.q, limit: filter.limit },
    });
    return res.subjects ?? [];
  }

  /** PATCH /v1/statements/{id} — close (invalidate) a statement; used by auto-resolve. */
  async closeStatement(id: number, validTo?: string): Promise<void> {
    await this.request({
      method: "PATCH",
      path: `/v1/statements/${id}`,
      body: validTo ? { valid_to: validTo } : { close: true },
    });
  }

  /** GET /v1/memory/notes — notes/memories, optionally scoped to a subject (for clustering). */
  async searchMemoryNotes(filter: {
    q?: string;
    subjectLike?: string;
    limit?: number;
    offset?: number;
    allSources?: boolean;
  }): Promise<MemoryNote[]> {
    const res = await this.request<{ notes?: MemoryNote[] }>({
      method: "GET",
      path: "/v1/memory/notes",
      query: {
        q: filter.q,
        subject_like: filter.subjectLike,
        limit: filter.limit,
        offset: filter.offset,
        all_sources: filter.allSources === undefined ? undefined : String(filter.allSources),
      },
    });
    return res.notes ?? [];
  }

  /** POST /v1/memory/consolidate — merge memories (api-server PR #9). Used on review accept. */
  consolidate(params: {
    memoryIds: number[];
    kind: string;
    title: string;
    summary: string;
    reason?: string;
  }): Promise<ConsolidateResult> {
    return this.request<ConsolidateResult>({
      method: "POST",
      path: "/v1/memory/consolidate",
      body: {
        memory_ids: params.memoryIds,
        kind: params.kind,
        title: params.title,
        summary: params.summary,
        reason: params.reason,
      },
    });
  }

  /** POST /v1/memory/lifecycle — transition an object's lifecycle state (api-server PR #9). */
  setLifecycle(params: {
    objectType: "fact" | "memory" | "episode_object";
    objectId: number;
    state: string;
    reason?: string;
  }): Promise<LifecycleResult> {
    return this.request<LifecycleResult>({
      method: "POST",
      path: "/v1/memory/lifecycle",
      body: {
        object_type: params.objectType,
        object_id: params.objectId,
        state: params.state,
        reason: params.reason,
      },
    });
  }

  /** POST /v1/memory/score — set a MAUT subscore (api-server PR #9), e.g. a downrank. */
  setScore(params: {
    objectType: "fact" | "memory" | "episode_object";
    objectId: number;
    category: string;
    subscore: number;
    evaluatorName: string;
    evaluatorKind?: string;
    evaluatorMeta?: unknown;
    evidence?: unknown;
  }): Promise<ScoreResult> {
    return this.request<ScoreResult>({
      method: "POST",
      path: "/v1/memory/score",
      body: {
        object_type: params.objectType,
        object_id: params.objectId,
        category: params.category,
        subscore: params.subscore,
        evaluator_name: params.evaluatorName,
        evaluator_kind: params.evaluatorKind,
        evaluator_meta: params.evaluatorMeta,
        evidence: params.evidence,
      },
    });
  }

  // --- request engine ----------------------------------------------------------

  private get namespace(): string {
    return this.config.namespace ?? "default";
  }

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = this.config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const init = this.buildInit(opts);

    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        const aborted = err instanceof Error && err.name === "AbortError";
        if (attempt <= maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw aborted
          ? new MaludbTimeoutError(opts.path, timeoutMs)
          : new MaludbNetworkError(opts.path, { cause: err });
      }
      clearTimeout(timer);

      if (response.ok) {
        return this.parseJson<T>(response);
      }

      if (response.status === 501) {
        const { code } = await this.parseError(response);
        throw new CapabilityUnavailableError(opts.path, code);
      }

      const { code, message, body } = await this.parseError(response);
      if (this.isRetryableStatus(response.status) && attempt <= maxRetries) {
        await this.backoff(attempt);
        continue;
      }
      throw new MaludbHttpError(response.status, code, message, body);
    }
  }

  private buildInit(opts: RequestOptions): RequestInit {
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth !== false) {
      headers.authorization = `Bearer ${this.config.token}`;
    }
    const init: RequestInit = { method: opts.method, headers };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return init;
  }

  private buildUrl(path: string, query?: Query): string {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const url = new URL(base + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status !== 501);
  }

  private async backoff(attempt: number): Promise<void> {
    const base = this.config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    const max = this.config.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    const ceiling = Math.min(base * 2 ** (attempt - 1), max);
    const delay = Math.floor(Math.random() * ceiling); // full jitter
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private async parseJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new MaludbError(`invalid JSON response from ${response.url || "MaluDB"}`, { cause: err });
    }
  }

  private async parseError(
    response: Response,
  ): Promise<{ code: string; message: string; body: unknown }> {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // leave body as the raw text
    }
    const envelope = (body as { error?: { code?: string; message?: string } } | undefined)?.error;
    return {
      code: envelope?.code ?? `http_${response.status}`,
      message: envelope?.message ?? response.statusText ?? "request failed",
      body,
    };
  }
}
