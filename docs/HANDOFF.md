# Handoff

Snapshot of the MaluDB Memory Organization Agent as of the initial build. Pairs with the
spec in this `docs/` folder and the grounding in [`CLAUDE.md`](../CLAUDE.md).

## What's built

A standalone TypeScript monorepo that maintains MaluDB memories **through the public API
only** (no SQL, no direct Core access — ADR-0001). All 14 planned units are done.

**Packages** (`packages/`, all built + unit-tested)
- `job-contracts` — Zod payload/result schemas per job type, the contract registry (`jobContracts`, `JobPayload<T>`/`JobResult<T>`, `parse*`), and the discriminated-union lifecycle events.
- `maludb-client` — typed API client: bearer auth (token = tenant), per-request timeout, bounded retry+jitter, `{error:{code,message}}` parsing, `501`→`CapabilityUnavailableError`. Methods for the 3 sweeps, statements, subjects, memory-notes, `closeStatement`, `consolidate`.
- `policy-engine` — full policy schema, YAML loader, default+override deep-merge (`resolveEffectivePolicy`), prioritization scoring, and `planScheduledJobs`.
- `agent-db` — operational Postgres: plain `pg` + embedded SQL migrations + typed repositories (tenants, policies, job_runs, review_items, cost_records, watermarks). No ORM.
- `observability` — Pino logger options, metrics/tracing hooks, and the `createJobEventSink` lifecycle emitter.
- `model-adapters` — provider-neutral interface + a real **Anthropic** adapter and `createAdapter` factory. `openai-compatible` / `ollama` are interface stubs.

**Apps** (`apps/`)
- `agent-api` (Fastify) — operator-auth-gated control plane: `/health`, `/v1/tenants`, `/v1/policies`, `/v1/jobs` (list/get/trigger/retry), `/v1/reviews` (list/get/resolve, execute-on-accept). Migrates `agent-db` on boot.
- `worker` (BullMQ) — migrates on boot, sets per-tenant repeatable schedules from policy, and runs job handlers with run recording + lifecycle events:
  - `tenant.healthcheck`, `policy.evaluate`
  - `memory.reindex.sweep`, `skills.reindex.sweep`, `embeddings.drain` — wired end-to-end (batch-loop until drained/capped, `501`→skip, watermarks)
  - `memory.contradiction.scan` — detect conflicting statements → model judge → `review_items` (cost-metered; `auto_resolve` off by default)
  - `memory.consolidation.scan` — cluster by subject → model judge → consolidation `review_items` (review-first)

**Tests:** `pnpm test` → 98 passing. **Build:** `pnpm build` clean.

**Companion PR:** `maludb-python-api-server` PR **#9** adds lifecycle/consolidate/score/retention endpoints (thin proxies over existing Core functions; no core change needed). Branch `feat/memory-maintenance-endpoints`, 358 tests green.

## How to run it

Prereqs: Node 24, `corepack` (pnpm is **not** on PATH — use `corepack pnpm …`), a Redis
instance, a Postgres for the agent's operational DB, and a MaluDB API token per tenant.

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test

cp .env.example .env   # set AGENT_DB_URL, REDIS_HOST/PORT, AGENT_ADMIN_TOKEN,
                       # ANTHROPIC_API_KEY (for the scan workers),
                       # and a per-tenant token env var, e.g. MALUDB_TOKEN__ACME=malu_xxx

corepack pnpm dev:api      # control plane (migrates agent-db on boot)
corepack pnpm dev:worker   # worker (migrates, schedules, processes; needs Redis)
```

Register a tenant and drive a job (operator auth = `AGENT_ADMIN_TOKEN`):

```bash
# tokenRef names the env var that holds the tenant's malu_ token (ADR-0004)
curl -X POST localhost:3000/v1/tenants -H "authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"id":"acme","apiBaseUrl":"https://api.maludb.org","tokenRef":"MALUDB_TOKEN__ACME"}'

# optional: store a policy (else schema defaults apply)
curl -X POST localhost:3000/v1/policies -H "authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"yaml\": $(jq -Rs . < examples/policies/default-policy.yaml)}"

# trigger a sweep now (the worker also schedules it from policy)
curl -X POST localhost:3000/v1/jobs -H "authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"tenantId":"acme","jobType":"memory.reindex.sweep"}'
```

Notes: the contradiction/consolidation workers need `ANTHROPIC_API_KEY` set; consolidation
also needs the tenant's MaluDB to support note search (Core ≥ 0.98.0) or it records
`capabilityUnavailable` and skips. The tenant's MaluDB login must be a member of
`maludb_memory_executor` for writes (the standard contract).

## Recently built

- **Review queue API + execute-on-accept** ✅ — `agent-api` now serves `/v1/reviews`
  (list/get) and `POST /v1/reviews/:id/resolve` (`{decision: accept|reject, actor?, note?}`).
  On **accept** it executes the review item's self-contained `proposedAction` through
  `maludb-client` (`closeStatement` for contradictions, `consolidate` for consolidations,
  `setLifecycle` for lifecycle) and records the result as resolution provenance; on
  **reject** it just closes the item. Each scan worker now attaches a typed `proposedAction`
  (`@maludb-agent/job-contracts` `reviewProposalSchema`) so accept is deterministic. New
  client methods `setLifecycle`/`setScore` map to PR #9's `/v1/memory/lifecycle` and
  `/v1/memory/score`. agent-db migration `0002` adds `resolved_by`/`resolution_note`/
  `resolution_result`; `resolveReviewItem` is now a compare-and-set on `status='open'`.
  Residual hardening: resolve is check→execute→CAS, so two *simultaneous* accepts of the
  same item could double-execute the (non-idempotent) consolidate before one is recorded —
  fine for an operator API, but a `resolving` claim state would make it exactly-once.

- **Capability probe in `tenant.healthcheck`** ✅ — the healthcheck now reads the tenant's
  `/openapi.json` and derives a complete per-tenant capability map (`maludb-client`
  `deriveCapabilities` / `CAPABILITY_ENDPOINTS`), persisted on the tenant row (replacing the
  old `{}`). `capabilityState` gives three-valued logic — `true`/`false` once probed,
  `undefined` when not — so callers only hard-block on an explicit `false` and an un-probed
  tenant is never locked out. The execute-on-accept path gates on it: accepting a review
  whose action needs an absent endpoint returns `422 capability_unavailable` and leaves the
  item open, instead of round-tripping to a 501. Probe failure degrades gracefully (empty
  map + warning). As PRs land per environment, capabilities light up with no agent redeploy.

## Open follow-ups (not built)
1. **First-class contradiction/review API in MaluDB** — currently deferred by decision
   (claim/fact-layer vs SVPOR-layer mismatch; see `api-contract.md` B.1/B.2). The agent uses
   its own `review_items` + `POST /v1/memory/score` (`contradiction_status`) meanwhile.
2. **Finish `model-adapters`** — real `openai-compatible` and `ollama` adapters (interfaces exist).
3. **Scored candidate listing + single-call provenance** — api-contract B.5/B.6 (need new
   API endpoints; the scoring module is designed to consume either source).
4. **Deploy** — systemd units for `agent-api` + `agent-worker` (supersede MaluDB's timers,
   ADR-0003); first deploy target is systemd, Docker optional later.
5. **Land PR #9** (and re-run `enable_memory_schema` per tenant if needed) so the lifecycle
   endpoints are available to the execute-on-accept path.

> Note: scan **scheduling** still gates reactively (runtime `501` → skip), not yet from the
> persisted capability map. Pre-gating scans on `capabilityState` is a natural extension.

## Map

`docs/decisions.md` (the why) · `requirements.md` · `architecture.md` · `api-contract.md`
(existing + new endpoints) · `policies.md` (schema + scoring) · `worker-design.md` (per-job).
