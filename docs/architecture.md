# Architecture

How the MaluDB Memory Organization Agent is put together, how data flows, and where the boundaries are. Read `decisions.md` first for the *why*; this document is the *what* and *how*.

## 1. One-paragraph summary

The agent is a small TypeScript monorepo running two long-lived processes — a Fastify **control API** and a BullMQ **worker** — backed by **Redis** (queue) and its own **Postgres** (operational state). It drives MaluDB maintenance entirely through the MaluDB public HTTP API via a shared, typed client. Tenant policies decide what runs, how often, in what priority, and with what guardrails. MaluDB Core stays the single source of truth for memory data; the agent stores only job/policy/run/review metadata.

## 2. Boundary diagram

```
        operator / CI                        per-tenant secrets (token refs)
             │                                          │
             ▼                                          ▼
   ┌───────────────────┐   enqueue    ┌───────────────────┐   HTTPS (Bearer malu_…)   ┌──────────────────────┐
   │   agent-api        │ ───────────▶ │   agent-worker     │ ─────────────────────────▶│  MaluDB API server    │
   │  (Fastify)         │              │  (BullMQ workers)  │   POST /v1/memory/...      │  (FastAPI)            │
   │  health, tenants,  │ ◀─────────── │  sweeps + scans    │ ◀─────────────────────────│                      │
   │  policies, jobs    │   status     └─────────┬─────────┘   results / errors         └──────────┬───────────┘
   └─────────┬─────────┘                         │                                                 │  SQL (psycopg)
             │                                    │                                                 ▼
             │  read/write                        │  read/write                          ┌──────────────────────┐
             ▼                                    ▼                                       │  MaluDB Core          │
   ┌──────────────────────────────────────────────────────┐                             │  (PG17 C extension)   │
   │            agent-db (PostgreSQL, agent-owned)          │     ┌──────────────┐       │  malu$* tables, RLS   │
   │  tenants · policies · job_runs · review_items ·        │     │   Redis      │       │  source→claim→fact→   │
   │  cost_records · watermarks                             │     │ (BullMQ)     │       │  memory, embeddings   │
   └──────────────────────────────────────────────────────┘     └──────────────┘       └──────────────────────┘

   ── hard boundary ──────────────────────────────────────────────────────────────────────────────────────────
   The agent NEVER crosses into MaluDB Core directly. Every memory operation goes through the MaluDB API server.
```

## 3. Runtime processes

| Process | Tech | Responsibility |
|---|---|---|
| `agent-api` | Fastify | Control plane: health, tenant CRUD, policy CRUD + validation, manual job triggers, job/run status. Writes jobs to Redis via BullMQ producers; reads run history from `agent-db`. |
| `agent-worker` | BullMQ | Data plane: executes scheduled and on-demand jobs. Hosts repeatable schedulers (one set of repeatable jobs per enabled tenant × job type). Calls MaluDB via `maludb-client`. Records runs/costs/review-items in `agent-db`. |
| `redis` | Redis | BullMQ backend: queues, repeatable schedules, retries, rate limits. Not a source of truth. |
| `agent-db` | PostgreSQL | Agent operational state only. Never mirrors memory data. |

Both app processes are thin: nearly all logic lives in the shared packages so it is testable in isolation and reused identically on both sides.

## 4. Monorepo layout

```
apps/
  agent-api/        Fastify control API (routes, plugins, server bootstrap)
  worker/           BullMQ worker entrypoint, queue definitions, schedulers, job handlers

packages/
  job-contracts/    Zod schemas for every job payload/result + lifecycle events. The shared vocabulary.
  maludb-client/    Typed MaluDB API client: auth, retries, timeouts, error envelope, per-endpoint methods.
  policy-engine/    Policy schema + loader/validator + versioning + prioritization scoring + evaluator.
  observability/    Pino logger, metrics/tracing hooks, job lifecycle event emitters.
  model-adapters/   Provider-neutral model interface + openai-compatible/anthropic/ollama adapters.

docs/               This documentation set.
examples/policies/  Concrete policy files validating against the policy schema.
```

Dependency direction (no cycles):

```
apps/agent-api  ─▶ job-contracts, policy-engine, observability, (db access)
apps/worker     ─▶ job-contracts, maludb-client, policy-engine, model-adapters, observability, (db access)
policy-engine   ─▶ job-contracts
maludb-client   ─▶ (standalone; only HTTP + its own types)
model-adapters  ─▶ (standalone; only HTTP + its own types)
observability   ─▶ (standalone)
job-contracts   ─▶ (standalone)
```

`maludb-client` and `model-adapters` are deliberately standalone so they can be extracted or generated (e.g. from OpenAPI) later without touching agent logic.

## 5. How MaluDB is reached

- **Auth.** Every call carries `Authorization: Bearer malu_<token>`. The token *is* the tenant selector — there is no tenant or namespace header. The worker loads the tenant's token (from its secret reference) when it picks up a job. (ADR-0004)
- **Namespace.** Passed as a body/query field (default `"default"`), only relevant to `/v1/memory/*` model-config and search partitioning.
- **Client responsibilities the CLI lacks.** The reference Rust CLI has no timeouts, retries, or pagination. `maludb-client` adds: per-call timeouts, bounded exponential backoff on transient failures (timeouts, 5xx), structured parsing of the `{"error":{"code","message"}}` envelope, and `501`-as-capability-unavailable handling.
- **Discovery.** `GET /openapi.json` exists; future work can generate types from it. For now `maludb-client` carries hand-written types matched to the verified contract in `api-contract.md`.

## 6. The job lifecycle

```
schedule (repeatable, per policy)  ──┐
manual trigger (control API)       ──┴─▶ BullMQ enqueue
                                            │
                                            ▼
                              worker picks up job  ──▶ load tenant + effective policy + token
                                            │
                                            ▼
                              record run = running (agent-db)
                                            │
                                            ▼
                        execute handler ──▶ maludb-client calls (+ model-adapter calls for scans)
                                            │
                              ┌─────────────┼──────────────┐
                              ▼             ▼              ▼
                         success        transient       terminal / 501
                         record done     error           record failed /
                         + outputs       retry w/ backoff capability-unavailable
                                            │
                                            ▼
                              emit lifecycle events (observability)
```

- **Idempotency.** Sweeps inherit Core's claim/apply idempotency. Intelligence writes (contradictions, review items) dedupe on stable keys so retries don't duplicate. (RR-1)
- **Watermarks.** Long sweeps record checkpoints in `agent-db` so a restarted run resumes instead of restarting. (RR-2)
- **Cost.** Model calls in scan jobs are metered against per-policy daily caps before the call is made. (OR-6)

## 7. Operational database (agent-owned)

Stores only agent metadata. Tables (see `worker-design.md` and the migrations for exact columns):

- `tenants` — id, api_base_url, token_ref, namespace, enabled, policy_id.
- `policies` — id, tenant scope, version, validated YAML/JSON, created_at.
- `job_runs` — id, tenant_id, job_type, status, policy_version, inputs, outputs, error, timing, retries.
- `review_items` — id, tenant_id, kind (contradiction/consolidation/lifecycle), payload, status (open/accepted/rejected), provenance.
- `cost_records` — id, tenant_id, job_run_id, model, calls, tokens, day bucket.
- `watermarks` — tenant_id + job_type → last checkpoint/cursor.

It never stores memory bodies as a source of truth. It may cache small identifiers/snippets needed to render a review item, clearly marked as derived. (Non-goal: no memory mirror.)

## 8. Capability gating (two-repo reality)

Some workers depend on API endpoints that are PRs in flight (ADR-0002). The agent treats MaluDB capabilities as discovered, not assumed:

- On `tenant.healthcheck`, probe which endpoints exist (presence in `/openapi.json` and/or trial calls). Persist a per-tenant capability map.
- Workers whose endpoints are absent are skipped for that tenant and reported in status — never crash-looped.
- This makes the agent forward-compatible: as API PRs land per environment, capabilities light up without redeploying the agent.

## 9. Why this shape

- **Two thin processes + fat shared packages** keeps logic unit-testable and identical across control/data planes.
- **API-only** (ADR-0001) means the agent survives Core schema churn; the contract is HTTP, not SQL.
- **Operational DB separate from MaluDB** keeps the source-of-truth boundary clean and lets the agent be wiped/rebuilt without risking memory data.
- **Policy-driven everything** makes per-tenant behavior data, not code.
- **Capability gating** lets a two-repo rollout proceed incrementally and safely.
