# CLAUDE.md — build guidance for this repo

Grounding for any Claude Code session building the MaluDB Memory Organization Agent. Read
[`docs/decisions.md`](./docs/decisions.md) and [`docs/api-contract.md`](./docs/api-contract.md) before writing code.

## What this project is

A standalone TypeScript background service that maintains MaluDB memories **only through the MaluDB
public HTTP API**. Two processes (`agent-api` Fastify control plane, `agent-worker` BullMQ data
plane) over shared packages, backed by Redis (queue) and its own PostgreSQL (operational state).

## Non-negotiable rules

1. **API-only.** Never open a Postgres connection to a MaluDB tenant DB. Never write SQL against
   `maludb_core`. The agent's own `agent-db` is the *only* database it connects to directly.
2. **No memory-data mirror.** `agent-db` stores job/policy/run/review/cost metadata only — never the
   memories themselves as a source of truth.
3. **No automatic destructive deletion.** Destructive/uncertain actions create review items.
4. **Provenance + explainability.** Every automated change traces to a job run, policy version, and
   (if any) a model call.
5. **Provider-neutral models.** All agent-side model calls go through `packages/model-adapters`.

## Verified MaluDB facts (don't re-derive; verify only if code seems to disagree)

- **Repo paths (local):** Core engine source = `/home/maludb/maludb-public` (NOT `maludb-core`; that
  dir does not exist). API server = `/home/maludb/maludb-python-api-server` (FastAPI). CLI =
  `/home/maludb/maludb-terminal` (Rust; good wire-contract reference).
- **Auth = token = tenant.** `Authorization: Bearer malu_<token>` on every call. The token resolves
  to a tenant's Postgres DB server-side. **No tenant header, no namespace header.** `namespace` is a
  body/query field, default `"default"`, only for `/v1/memory/*` model-config + search partitioning.
- **Versioning:** literal `/v1` path segment. `/health` is unauthenticated. `GET /openapi.json`,
  `/docs`, `/redoc` exist (response schemas are untyped — `docs/api-contract.md` is authoritative).
- **Error envelope:** `{"error":{"code","message"}}`. Watch `model_not_configured`,
  `model_api_key_missing`.
- **The three real sweep endpoints** (synchronous "drain one batch", do model work server-side):
  `POST /v1/memory/reindex/run`, `POST /v1/skills/reindex/run`, `POST /v1/memory/embeddings/run`.
  They return `501` on older Core versions → treat as "capability unavailable", not failure.
- **The reference CLI has no timeouts/retries/pagination** — `maludb-client` must add them.
- **API gap:** consolidation, contradiction *writes*, stale/downrank/lifecycle, score-ranked
  candidate listing, single-call provenance are NOT exposed yet. Core *implements* them
  (`consolidate_memories`, `propagate_staleness`, `apply_lifecycle_state`, `set_maut_score`,
  supersession, `fact_claim.role='contradicts'`). New API endpoints proxy these (see api-contract
  Part B). **Contradiction detection logic exists nowhere** — it's the agent's net-new value.

## Canonical names (keep consistent across code)

Job types: `tenant.healthcheck`, `policy.evaluate`, `memory.reindex.sweep`, `skills.reindex.sweep`,
`embeddings.drain`, `memory.contradiction.scan`, `memory.consolidation.scan`.

Packages: `job-contracts`, `maludb-client`, `policy-engine`, `observability`, `model-adapters`
(npm scope suggestion: `@maludb-agent/*`).

## Tech stack & conventions

- Node.js 24 LTS, TypeScript (ESM), pnpm workspace, Vitest, Pino, Zod, Fastify, BullMQ.
- Fat shared packages, thin apps. No cyclic deps (see architecture.md §4).
- Explicit over clever; small modules; don't hide important logic behind framework magic.
- Match surrounding style; keep comments at the density of the file you're editing.
- First deploy target is systemd; **do not** require Docker for local dev.

## Build order (tasks tracked in the session task list)

1. Spec docs ✅ · example policies ✅ · README ✅
2. Workspace scaffold + root config
3. `job-contracts` → `maludb-client` → `policy-engine` (with scoring tests) → `observability` → `model-adapters`
4. `agent-api` (health first, then routes) · `agent-worker` (3 real sweeps end-to-end first)
5. Operational DB schema + migrations
6. Contradiction detection worker + the new API endpoints it needs (PRs on maludb-python-api-server)

## First milestone definition of done

Runnable scaffold: workspace builds, `agent-api` serves `/health`, `agent-worker` connects to Redis,
BullMQ queues exist for all 7 job types, the 3 real sweeps execute end-to-end against a live MaluDB
token, policy schema validates the example files, scoring + contract unit tests pass.
