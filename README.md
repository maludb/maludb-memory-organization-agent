# MaluDB Memory Organization Agent

A standalone background service that schedules, prioritizes, and executes memory-maintenance
workflows for [MaluDB](https://github.com/maludb) tenants — **entirely through the MaluDB public API.**

It is the policy-aware, multi-tenant, observable replacement for MaluDB's fixed-cadence systemd
maintenance timers, and the home for memory intelligence that the database engine cannot perform on
its own (starting with **contradiction detection**).

> **Status:** planning + scaffold. The documentation set in [`docs/`](./docs) is the build spec.
> See [`docs/decisions.md`](./docs/decisions.md) for the decisions that shape the project.

## What it does

- Drives the three MaluDB maintenance sweeps under per-tenant policy:
  memory reindex, skills reindex, embedding refresh.
- Detects contradictions between stored facts and routes them to a human review queue.
- (Phase 2, API-gated) consolidates related memories, marks staleness, downranks/archives —
  always preserving provenance, never deleting automatically.
- Keeps its own operational database of jobs, policies, runs, costs, and review items —
  **never a copy of your memory data.**

## Hard boundary

This service talks to MaluDB **only** over the public HTTP API. It never opens a Postgres
connection to a MaluDB tenant database and never issues SQL against MaluDB Core. MaluDB Core stays
the single source of truth for memory data. (See [`docs/decisions.md`](./docs/decisions.md) ADR-0001.)

## Key decisions (locked)

| | Decision |
|---|---|
| **Scope** | Ship the agent spine **and** the new API endpoints it needs (PRs on `maludb-python-api-server` that proxy existing Core functions). |
| **Timers** | This agent **supersedes** MaluDB's existing systemd maintenance timers. |
| **Auth** | Operator provisions a per-tenant bearer token (the token *is* the tenant); the agent never holds Postgres credentials. |
| **First intelligence** | **Contradiction detection** — the one capability Core stores but cannot detect. |

## Architecture at a glance

Two thin long-lived processes over fat, testable shared packages:

- **`agent-api`** (Fastify) — control plane: health, tenant + policy management, manual job triggers, job status.
- **`agent-worker`** (BullMQ) — data plane: runs scheduled and on-demand jobs against the MaluDB API.
- **`redis`** — BullMQ queue backend.
- **`agent-db`** (PostgreSQL) — the agent's own operational state.

```
apps/
  agent-api/     Fastify control API
  worker/        BullMQ worker, queues, schedulers, job handlers
packages/
  job-contracts/ Zod schemas for job payloads/results + events (shared vocabulary)
  maludb-client/ Typed MaluDB API client (auth, retries, timeouts, error envelope)
  policy-engine/ Policy schema + validation + versioning + prioritization scoring
  observability/ Pino logging + metrics/tracing hooks + lifecycle events
  model-adapters/Provider-neutral model interface (openai-compatible / anthropic / ollama)
docs/            Build spec (start here)
examples/policies/ Concrete, schema-valid policy files
```

Full detail: [`docs/architecture.md`](./docs/architecture.md).

## Tech stack

TypeScript · Node.js 24 LTS · Fastify · BullMQ + Redis · PostgreSQL · pnpm workspace · Vitest · Pino · Zod · OpenTelemetry-ready.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/decisions.md`](./docs/decisions.md) | Architecture Decision Records (the *why*). |
| [`docs/requirements.md`](./docs/requirements.md) | Functional + non-functional requirements. |
| [`docs/architecture.md`](./docs/architecture.md) | Components, processes, boundaries, data flow. |
| [`docs/api-contract.md`](./docs/api-contract.md) | Existing endpoints used + new endpoints to add (with the Core function each proxies). |
| [`docs/policies.md`](./docs/policies.md) | Policy schema + the prioritization scoring formula. |
| [`docs/worker-design.md`](./docs/worker-design.md) | Each job: inputs, outputs, failure, retry, idempotency, API calls. |

## Getting started (planned)

> The workspace scaffold is the next milestone; these are the intended commands.

```bash
pnpm install
cp .env.example .env   # configure Redis + agent-db + operator admin token
pnpm build             # tsc -b across the workspace (project references)
pnpm test              # vitest across all packages
pnpm dev:api           # run the control API (tsx watch)
pnpm dev:worker        # run the worker (needs Redis running)
```

Tenants and policies are registered through the control API (or seeded from `examples/policies/`).
A tenant registration provides the MaluDB `api_base_url`, a bearer-token secret reference, the
`namespace` (default `"default"`), and the policy to apply.

## Related repositories

- **MaluDB API server** — `maludb-python-api-server` (the only interface this agent uses; new endpoints land here).
- **MaluDB Core** — the PostgreSQL extension engine (source: `maludb-public`); authority for all memory data.
- **MaluDB terminal** — `maludb-terminal` (reference Rust CLI for the wire contract).

## Non-goals (V1)

No direct SQL/DB access · no web UI · no automatic destructive deletion · no single-provider lock-in ·
no Docker requirement for local dev · no memory-data duplication · no multi-agent framework before the
basics are stable.
