# Architecture Decision Records

Short, dated records of the decisions that shape this service. Each is **Context → Decision → Consequences**. Supersede rather than edit when a decision changes.

---

## ADR-0001 — The agent reaches MaluDB only through the public API

**Date:** 2026-06-20 · **Status:** Accepted

**Context.** MaluDB Core is a PostgreSQL 17 C extension (source at `/home/maludb/maludb-public`, schema `maludb_core`, ~180 `malu$*` tables). The API server (`/home/maludb/maludb-python-api-server`, FastAPI) is the only sanctioned entry point and owns per-tenant DB credentials. Talking to Core directly would couple this service to ~50k lines of evolving SQL and bypass tenant RLS, auth, and provenance guarantees.

**Decision.** This service makes HTTP calls to the MaluDB API exclusively. It never opens a Postgres connection to a MaluDB tenant database, never issues SQL against `maludb_core`, and treats Core as a black box behind the API.

**Consequences.** Any capability the agent needs but the API does not expose becomes an API feature request (see ADR-0002), not a direct DB query. The agent keeps its *own* operational database for job state — never a mirror of memory data (see ADR-0004). MaluDB Core remains the single source of truth for memories.

---

## ADR-0002 — V1 ships agent spine **and** the API endpoints it depends on

**Date:** 2026-06-20 · **Status:** Accepted

**Context.** Research into the live API found that the three batch "sweep" endpoints exist and work today (`/v1/memory/reindex/run`, `/v1/skills/reindex/run`, `/v1/memory/embeddings/run`), but the advanced capabilities this product promises — consolidation, contradiction handling, stale/downrank, score-ranked candidate listing, single-call provenance — are **not exposed by the API**. Critically, Core *already implements* almost all of them (`consolidate_memories`, `propagate_staleness`, `apply_lifecycle_state`, `set_maut_score`, supersession edges, `fact_claim.role='contradicts'`). The missing layer is mostly thin API proxies over existing Core functions.

**Decision.** V1 delivers (a) the fully-runnable agent spine that schedules the three real sweeps under per-tenant policy, plus (b) a set of new API endpoints on `maludb-python-api-server` that proxy existing Core functions, delivered as separate PRs. The agent is built against those endpoints; where an endpoint is not yet merged, the client method exists but the worker is feature-flagged off.

**Consequences.** Work spans two repositories. `docs/api-contract.md` is the contract between them and names the exact Core function each new endpoint wraps. The agent must degrade gracefully when an endpoint returns `501`/`404` (the sweep endpoints already return `501` on older Core versions — the client treats this as "capability unavailable," not a hard error).

---

## ADR-0003 — The agent supersedes the existing systemd timers

**Date:** 2026-06-20 · **Status:** Accepted

**Context.** MaluDB ships `maludb-*.timer` systemd units that POST to the three sweep endpoints on a fixed cadence; its README calls them "the background agent." They are not policy-aware, not multi-tenant-prioritized, and have no shared observability or job history.

**Decision.** This service becomes the single driver of MaluDB background maintenance. The legacy timers are retired at deploy time.

**Consequences.** The agent owns scheduling cadence per tenant and per job type. Because the sweep endpoints claim work with `FOR UPDATE SKIP LOCKED` semantics in Core, the design remains safe even if a stray timer runs concurrently during migration — but the target end state is one driver. Deployment docs must include the timer-disable step.

---

## ADR-0004 — Tenant credentials are operator-provisioned bearer tokens

**Date:** 2026-06-20 · **Status:** Accepted

**Context.** MaluDB auth is token-as-tenant: `Authorization: Bearer malu_<...>`; the server hashes the token and resolves it to a tenant's Postgres credentials. There is no tenant header and no namespace header (namespace is a per-request body/query field defaulting to `"default"`). Tokens are minted via `POST /v1/tokens` using raw Postgres credentials.

**Decision.** Each tenant is registered in the agent's operational DB as `(tenant_id, api_base_url, bearer_token_ref, namespace, policy_id)`. The token is held as a reference to a secret (env/secret store), not minted by the agent. The agent never stores or handles raw Postgres credentials.

**Consequences.** Smallest credential blast radius: a compromised agent leaks API tokens scoped to memory operations, not database superuser creds. Token rotation is an operator/secret-store concern. Multi-tenancy is a loop over the tenant registry; "all tenants" fan-out is the default scheduling unit.

---

## ADR-0005 — Contradiction detection is the first net-new capability

**Date:** 2026-06-20 · **Status:** Accepted

**Context.** Of the advanced capabilities, contradiction handling is unique: Core stores contradictions (`malu$fact_claim.role='contradicts'`, MAUT `contradiction_status`, a fact EXCLUDE constraint preventing two active facts for the same subject/verb/predicate) but **no component detects them**. Consolidation, staleness, and lifecycle already have Core logic that just needs proxying. Detection is the only capability requiring the agent's own model calls and genuinely new intelligence.

**Decision.** After the sweep spine is solid, contradiction detection is the first intelligence worker built. It pulls statements/facts via the API, groups by subject, uses a model adapter to judge semantic contradiction, and writes contradiction + review-queue items through new API endpoints. Detection is advisory by default (`auto_resolve: false`): it creates review items, it does not retract facts.

**Consequences.** `model-adapters` becomes load-bearing here (it is interface-only for the sweep spine). The review-queue endpoint and a human-review workflow are prerequisites. Consolidation and lifecycle follow once the detection → review pattern is proven, reusing the same review/provenance machinery.

---

## Cross-cutting principles (carried from the project brief, still in force)

- Jobs are idempotent and retry-safe.
- Every automated change preserves provenance and records *why* it happened.
- Destructive or uncertain actions require explicit policy permission or human review; no automatic destructive deletion in V1.
- Model calls are abstracted behind provider adapters; local and cloud models both supported.
- Policies are versioned and validated before use.
- Packages stay small and explicit; avoid framework magic that hides important logic.
