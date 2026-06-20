# Requirements

MaluDB Memory Organization Agent — functional and non-functional requirements for V1, grounded in the verified MaluDB API/Core reality (see `architecture.md` and `api-contract.md`).

## 1. Purpose

A standalone background service that schedules, prioritizes, and executes memory-maintenance workflows for MaluDB tenants **through the MaluDB public API**. It is the policy-aware, multi-tenant, observable replacement for MaluDB's fixed-cadence systemd maintenance timers, and the home for net-new memory intelligence (starting with contradiction detection) that Core cannot perform on its own.

## 2. Scope (V1)

In scope:

- A control API (Fastify) for tenant registration, policy management, manual job triggers, and job/run status.
- A worker (BullMQ over Redis) that runs scheduled and on-demand maintenance jobs.
- An operational database (Postgres) for the agent's own state — tenants, policies, job runs, watermarks, review items, cost records.
- A typed MaluDB API client with retries, timeouts, and structured error handling.
- A policy engine: schema, validation, versioning, prioritization scoring.
- End-to-end execution of the three sweeps that the API supports today.
- New API endpoints on `maludb-python-api-server` (separate PRs) that proxy existing Core functions, enabling the intelligence layer.
- Scaffolding + first implementation of contradiction detection as the first intelligence worker.
- Model-adapter interfaces (provider-neutral), with adapters used by contradiction detection.
- Observability: structured logging, metrics/tracing hooks, job lifecycle events.

## 3. Non-goals (V1)

- No direct SQL or direct Postgres connection to any MaluDB tenant database (ADR-0001).
- No web UI.
- No automatic destructive deletion of memories. Destructive/uncertain actions create review items.
- No tight coupling to a single model provider.
- No Docker requirement for local development (systemd is the first deploy target; Docker may come later).
- No duplication of MaluDB memory data as a source of truth in the agent DB.
- No complex multi-agent framework before the basic worker system is stable.

## 4. Core functional requirements

### 4.1 Tenant management
- **FR-T1** Register a tenant with `api_base_url`, a bearer-token secret reference, `namespace` (default `"default"`), and an assigned policy. (ADR-0004)
- **FR-T2** List, update, enable/disable tenants via the control API and operational DB.
- **FR-T3** Per-tenant health check: verify `GET /health` and `GET /v1/memory/config` succeed before scheduling work.

### 4.2 Policy management
- **FR-P1** Load policies from YAML, validate against schema, and store versioned in the operational DB.
- **FR-P2** Reject invalid policies with actionable errors; never run a job under an unvalidated policy.
- **FR-P3** Resolve the effective policy for a tenant (tenant-specific overrides on top of a default policy).
- **FR-P4** Policies drive: sweep cadence and batch sizes, domain/priority weighting, age thresholds, cost controls, model preferences, consolidation rules, contradiction handling, archive/downrank rules, and review requirements.

### 4.3 Job scheduling & execution
- **FR-J1** Provide these job types (names are canonical across the codebase):
  - `memory.reindex.sweep` → drives `POST /v1/memory/reindex/run`
  - `skills.reindex.sweep` → drives `POST /v1/skills/reindex/run`
  - `embeddings.drain` → drives `POST /v1/memory/embeddings/run`
  - `tenant.healthcheck` → `GET /health` + `GET /v1/memory/config`
  - `policy.evaluate` → compute priorities and enqueue downstream work
  - `memory.contradiction.scan` → detect contradictions (first intelligence worker)
  - `memory.consolidation.scan` → propose consolidations (phase 2, endpoint-gated)
- **FR-J2** Schedule jobs per tenant on policy-defined cadences (BullMQ repeatable jobs), and allow manual triggering via the control API.
- **FR-J3** Each job run is recorded in the operational DB with status, timing, inputs, outputs, errors, and the policy version used.
- **FR-J4** Retry failed jobs with backoff; cap retries; record retry metadata; expose a manual retry endpoint.

### 4.4 Sweep workers (buildable against today's API)
- **FR-S1** `memory.reindex.sweep` POSTs to `/v1/memory/reindex/run` with policy-derived `limit`, `max_age`, optional `source_type`; records `{claimed, reindexed, skipped, errors}`; loops batches until the queue drains or a per-run cap is hit.
- **FR-S2** `skills.reindex.sweep` and `embeddings.drain` behave analogously against their endpoints.
- **FR-S3** A `501` response (capability unavailable on the tenant's Core version) marks the capability unsupported for that tenant and is not treated as a job failure.

### 4.5 Contradiction detection (first intelligence worker — ADR-0005)
- **FR-C1** For a tenant, select candidate subjects/facts to examine (policy-scored; see scoring).
- **FR-C2** Retrieve the relevant statements/facts and their provenance via the API.
- **FR-C3** Use a model adapter to judge whether facts about the same subject/verb/predicate contradict.
- **FR-C4** Write a contradiction record and a review item via the new API endpoints; never auto-retract unless policy explicitly enables `auto_resolve` (default off).
- **FR-C5** Record model-call cost and the provenance of the detection (model, prompt, inputs hash).

### 4.6 Prioritization scoring
- **FR-SC1** Provide a pure, unit-tested scoring function combining staleness, retrieval frequency, policy domain weight, low-confidence, contradiction signal, model-version-change, minus recent-failure and low-value-decay penalties.
- **FR-SC2** Scoring inputs come only from API-visible signals (confidence, provenance, validity windows, last-indexed watermarks, salience/reinforcement where exposed) — never from direct DB access.

### 4.7 Provenance & explainability
- **FR-X1** Every automated change the agent causes is traceable to a job run, policy version, and (if applicable) a model call.
- **FR-X2** The agent can answer "why was this memory reindexed/flagged/consolidated/queued for review" from its operational DB.

## 5. Security requirements

- **SR-1** Bearer tokens stored as secret references, never in plaintext config or logs (ADR-0004).
- **SR-2** Logs redact tokens and any memory content beyond what is needed for debugging.
- **SR-3** The agent holds no MaluDB Postgres credentials.
- **SR-4** Control API authenticates its own callers (operator auth) — at minimum a static admin token in V1, designed to be replaceable.
- **SR-5** Per-tenant isolation: a job for tenant A can never use tenant B's token or write to tenant B.

## 6. Operational requirements

- **OR-1** Runs as separate processes: `agent-api`, `agent-worker`, with `redis` and `agent-db` as dependencies. First deploy target is systemd units; no Docker required.
- **OR-2** Configuration is validated at startup (Zod); the process refuses to start on invalid config.
- **OR-3** Structured JSON logging (Pino) with correlation IDs spanning a job run.
- **OR-4** Metrics and tracing hooks present and OpenTelemetry-ready (no full OTel wiring required in V1).
- **OR-5** Graceful shutdown: in-flight jobs finish or are returned to the queue; no half-applied agent state.
- **OR-6** Cost controls enforced per policy: max model calls/tokens per day per tenant; prefer local models for low-priority work when configured.

## 7. Reliability requirements

- **RR-1** Jobs are idempotent: re-running a job produces no duplicate side effects. Sweeps are naturally idempotent (Core claim/apply); intelligence writes must dedupe via stable keys (e.g., contradiction key = tenant+subject+verb+predicate).
- **RR-2** Watermarks/checkpoints recorded so a restarted sweep resumes sensibly.
- **RR-3** The agent tolerates API transient failures (timeouts, 5xx) with bounded retries; it distinguishes transient (retry) from terminal (`4xx`, capability `501`) outcomes.

## 8. Policy requirements

See `policies.md` for the full schema. Requirements:

- **PR-1** Policies are versioned; the version used is recorded on every job run.
- **PR-2** A default policy applies to any tenant without an explicit one.
- **PR-3** Destructive actions (archive, downrank, retract) require an explicit policy flag; otherwise they produce review items.
- **PR-4** Policy validation is total: unknown fields are rejected or warned, ranges are bounded.

## 9. Out-of-scope capabilities that require API additions (tracked in api-contract.md)

These are V1 *targets* but gated on the corresponding API PRs landing:

- Score-ranked candidate memory listing.
- Single-call memory-with-provenance retrieval.
- Consolidation object creation.
- Explicit stale / downrank / lifecycle actions.
- Contradiction + review-queue object creation.

Until each lands, the dependent worker is feature-flagged off per tenant and the gap is surfaced in health/status output rather than failing silently.
