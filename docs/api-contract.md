# MaluDB API Contract

The interface between this agent and `maludb-python-api-server`. Two halves:

- **Part A — Existing endpoints** the agent uses today (verified against the live FastAPI source and the Rust CLI). These are stable; build against them now.
- **Part B — New endpoints** to add to the API server (ADR-0002) so the intelligence layer has somewhere to read scored candidates and write contradictions/consolidations/lifecycle changes. Each names the existing MaluDB Core function it should proxy, so the PRs are thin wrappers, not engine work.

> Conventions. Base URL per tenant. Auth on every call: `Authorization: Bearer malu_<token>` — **the token selects the tenant; there is no tenant or namespace header.** `namespace` is a body/query field (default `"default"`). Versioned as a literal `/v1` path segment. Errors use `{"error":{"code","message"}}`. `GET /openapi.json`, `/docs`, `/redoc` exist (response bodies are untyped in the spec, so this document is authoritative for response shapes).

---

## Part A — Existing endpoints (use now)

### A.1 Health & config
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | Liveness. Used by `tenant.healthcheck`. |
| GET | `/v1/memory/config` | yes | `?namespace`. Returns `{namespace, config}`. Confirms token validity + namespace setup. |

### A.2 The three sweep endpoints (the spine)
These are **synchronous "drain one batch"** calls — they do the work server-side (including model calls via the tenant's configured models) and return a summary. The agent paces and loops them.

| Method | Path | Query | Returns | Unavailable when |
|---|---|---|---|---|
| POST | `/v1/memory/reindex/run` | `limit` (≤200, default 32), `max_age` (e.g. `"30 days"`), `source_type?` | `{claimed, reindexed[], skipped[], errors[], limit, max_age, source_type}` | `501` if Core < 0.100.0 |
| POST | `/v1/skills/reindex/run` | `limit` (default 32), `max_age` | `{claimed, reindexed[], errors[], model, limit, max_age}` | `501` if Core < 0.99.0 |
| POST | `/v1/memory/embeddings/run` | `limit` (≤512, default 64), `kinds` (e.g. `subject,verb`) | `{claimed, embedded[], errors[], model, limit, kinds}` | `501` if Core < 0.95.0 |

**Looping contract.** Call repeatedly with the policy's `batch_limit` until `claimed == 0` or a per-run cap (max batches / wall-clock / cost) is reached. `errors[]` entries do not abort the loop; they are recorded per-item. A `501` marks the capability unsupported for that tenant (not a failure).

### A.3 Read endpoints used by scoring & detection
| Method | Path | Key params | Returns (relevant fields) |
|---|---|---|---|
| GET | `/v1/statements` | `provenance?`, `subject_kind?`, `subject_id?`, `verb_id?`, `object_kind?`, `object_id?`, `limit` (≤200) | `{statements:[{id, subject_kind, subject_id, verb_id, object_kind, object_id, predicate_id, valid_from, valid_to, confidence, provenance, source_package_id, metadata, created_at}]}` |
| GET | `/v1/statements/{id}` | — | single statement (as above) |
| GET | `/v1/subjects` | `q?`, `subject?`, `limit`, `with?` | `{subjects:[{id, label, type, description, linked_verbs, related_subjects}]}` |
| GET | `/v1/memory/notes` | `q?`, `subject_like?` (repeatable), `verb_like?`, `limit`, `offset`, `all_sources?` | `{count, notes:[{id, title, source_type, snippet, created_at, match_count, matched_edges}]}` — only endpoint with real offset pagination |
| POST | `/v1/memory/search` | body `{query, namespace, subject?, verb?, limit, metric?}` | `{results:[{chunk_id, statement_id, document_id, source_text, distance, similarity, rank_no, subject_name, verb_name}]}` — requires a subject and/or verb pre-filter; no score threshold param |

These are the inputs to `memory.contradiction.scan`: enumerate a subject's statements, group by `(subject, verb, predicate)`, inspect `confidence` / `provenance` / `valid_from`..`valid_to`.

### A.4 Write endpoints usable today (limited)
| Method | Path | Use |
|---|---|---|
| PATCH | `/v1/statements/{id}` | body `{provenance}` and/or `{close:true \| valid_to}`. The only existing way to invalidate/close an edge or move it through the `suggested→accepted/rejected` provenance lifecycle. Adjacent to "downrank/retract" but coarse. |
| POST/PATCH | `/v1/notes`, `/v1/notes/{id}` | Generic note store. `type='issue'` supports an issue workflow: `POST /v1/notes/{id}/close-issue`, `/reopen-issue`. **V1 review queue can ride on this** (see Part B.4) before a dedicated endpoint lands. |
| POST | `/v1/memory/ingest`, `/v1/memory/documents` | Ingest (server extracts). The agent generally does not ingest, but may use ingest to record agent-authored notes/provenance if needed. |

### A.5 Model/provider config (per tenant)
`GET /v1/llm/catalog`, `GET/PUT/DELETE /v1/llm/providers[/{provider}]`, `GET/PUT/DELETE /v1/llm/models[/{task}]` (tasks: `extract`, `skill_extract`, `embed`). The agent does **not** need these for sweeps (server already uses the tenant's configured models). Relevant only if the agent surfaces "model not configured" health warnings (error codes `model_not_configured`, `model_api_key_missing`).

---

## Part B — New endpoints to add (PRs on maludb-python-api-server)

Each endpoint is a thin proxy over an **existing Core function** (verified present in `/home/maludb/maludb-public/sql/extension/maludb_core--0.100.0.sql`). The agent calls only these; it never calls Core directly. Build order follows ADR-0005: contradiction/review first, then lifecycle/score, then consolidation, then candidates/provenance as needed.

> All new endpoints: same auth (token=tenant), accept `namespace` where relevant, return `{"error":{"code","message"}}` on failure, and should appear in `/openapi.json` so the agent's capability probe detects them.

> **Implementation note (verified).** These are **API-only** changes — no `maludb-public` core PR is needed. The tenant role inherits `maludb_memory_executor` (which has `USAGE ON SCHEMA maludb_core`), and the target functions are `SECURITY INVOKER` with PUBLIC/executor `EXECUTE`, so the API calls `maludb_core.<fn>(...)` directly inside `db_tx_core` (same pattern as the existing `maludb_core.secret_set` call). Each endpoint guards with a `pg_proc` check → `501` when the core build is too old.
>
> **Status:** B.3 (lifecycle/staleness/score/reinforcement), B.4 (consolidate), and B.3's retention-candidates are **implemented** in `maludb-python-api-server` PR #9, at these actual paths:
> `POST /v1/memory/consolidate`, `POST /v1/memory/lifecycle`, `POST /v1/memory/staleness`, `POST /v1/memory/score`, `POST /v1/memory/reinforcement`, `GET /v1/memory/retention-candidates`.
> B.1/B.2 (contradiction/review) are **deferred pending a modeling decision** — Core stores contradictions at the claim/fact layer (`malu$fact_claim role='contradicts'`, no insert helper) while the agent reads the SVPOR-statement layer. In the meantime the contradiction worker can record findings in the agent's own `review_items` and signal MaluDB via `POST /v1/memory/score` (`category=contradiction_status`).

### B.1 Contradiction write (priority — ADR-0005)
**Need.** After detection, persist a contradiction so Core/UX can act on it and so the agent can dedupe.
- `POST /v1/contradictions`
  - Body: `{subject_kind, subject_id, verb_id, predicate_id?, statement_ids:[...], detected_by, confidence, rationale, namespace?}`
  - Behavior: link the conflicting claims with `malu$fact_claim.role='contradicts'`; optionally set MAUT `contradiction_status` via `set_maut_score`. Returns `{contradiction_id, review_item_id?}`.
  - Core functions: `malu$fact_claim` insert (`role='contradicts'`), `set_maut_score(...)`. The fact EXCLUDE constraint (`maludb_core--0.100.0.sql`) already guarantees only one active fact per `(subject,verb,predicate)`; cross-window/cross-claim conflicts are what the agent surfaces.
- `GET /v1/contradictions` — list for review/dedupe. Params: `status?`, `subject_id?`, `limit`, `offset`. Returns stored contradictions with their statement links and status.

### B.2 Review queue (priority — supports human-in-the-loop)
**Need.** Destructive/uncertain actions create review items instead of acting (PR-3, FR-C4).
- `POST /v1/reviews` — `{kind: contradiction|consolidation|lifecycle, refs:{...}, summary, proposed_action, provenance}` → `{review_item_id, status:"open"}`
- `GET /v1/reviews` — `status?`, `kind?`, `limit`, `offset`.
- `POST /v1/reviews/{id}/resolve` — `{decision: accept|reject, actor, note?}`. On accept, the API applies the proposed action (e.g. calls `consolidate_memories` or `apply_lifecycle_state`).
- **V1 fallback (no new endpoint):** model review items as notes with `type='issue'` via existing `/v1/notes` + `/v1/notes/{id}/close-issue|reopen-issue`. The agent's review abstraction targets this contract so swapping to `/v1/reviews` later is internal. Core candidate for a first-class store: `malu$pending_claim` (review-staging buffer) already exists.

### B.3 Lifecycle / stale / downrank
**Need.** Apply staleness, archival, retirement, and score adjustments — the safe ones automatable per policy, the destructive ones via review.
- `POST /v1/memory/{kind}/{id}/lifecycle` — `{state: stale|archived|retired, reason, actor}`
  - Core: `apply_lifecycle_state(...)` (archive/retire), `propagate_staleness(type,id)` (sets `stale_after` + cascades), refusing if on legal hold (`prune_object` guards already enforce this).
- `POST /v1/memory/{kind}/{id}/score` — `{category, score, evaluator_kind, rationale}` for downranking/confidence adjustment.
  - Core: `set_maut_score(...)`, and/or `record_reinforcement(...)` for access/edit/review events feeding `compute_salience`.
- `GET /v1/memory/retention-candidates` — surface rows Core already flags as eligible. Core: `retention_candidates(...)`.

> Destructive states (`retired`, prune) must require review acceptance per policy; `stale` and score adjustments may be automated when policy allows.

### B.4 Consolidation
**Need.** Merge related memories while preserving provenance.
- `POST /v1/memory/consolidate` — `{memory_ids:[...], strategy?, create_summary?, namespace?}` → `{consolidated_into_memory_id, supersession_edges:[...]}`
  - Core: `consolidate_memories(bigint[], ...)` — already creates the new memory, marks sources `consolidated`, writes supersession edges + ledger + reinforcement. The proxy is genuinely thin.
- Candidate selection is the agent's job (clustering related memories); the endpoint only executes an approved merge.

### B.5 Scored candidate listing
**Need.** "Give me the memories most worth working on for this policy." No such endpoint exists today; `/v1/memory/search` requires a subject/verb pre-filter and has no score sort.
- `GET /v1/memory/candidates` — params: `order_by` (staleness|salience|confidence|contradiction|last_indexed), `min_score?`, `domain?`, `max_age?`, `limit`, `offset` → `{candidates:[{memory_id, kind, subject, score_components:{...}, last_indexed, lifecycle_state}]}`
  - Core: derive from MAUT (`malu$maut_score`, `maut_aggregate_confidence`), salience (`compute_salience` over `malu$reinforcement_event`), `stale_after`, `last_indexed` watermarks. This is the heaviest new endpoint; until it lands the agent approximates ranking from `/v1/statements` + watermarks client-side, and the scoring module is designed to consume either source.

### B.6 Memory-with-provenance (single call)
**Need.** Render "why" for a review item without N round-trips.
- `GET /v1/memory/{kind}/{id}/provenance` → `{object, derivation:[...], sources:[...], supersession:[...], claims:[...]}`
  - Core: assemble from `malu$derivation_ledger`, `malu$source_package`, `malu$supersession_edge`, and related `malu$svpor_statement` / `malu$claim`. Until it lands, the agent composes this from existing `/v1/statements` + `/v1/documents/{id}`.

---

## Part C — Capability discovery

The agent does not assume Part B exists. On `tenant.healthcheck` it builds a per-tenant capability map by:
1. Fetching `/openapi.json` and checking for each path.
2. Optionally trial-calling idempotent reads (e.g. `GET /v1/contradictions?limit=1`) and treating `404`/`501` as "absent."

Workers gated on an absent capability are skipped for that tenant and reported in status output. As PRs land in an environment, capabilities light up with no agent redeploy. (architecture.md §8)

---

## Part D — Summary: agent need → endpoint → Core function

| Agent need | Endpoint | Exists? | Core function proxied |
|---|---|---|---|
| Reindex docs/notes | `POST /v1/memory/reindex/run` | ✅ | `maludb_memory_reindex_claim/_apply` |
| Reindex skills | `POST /v1/skills/reindex/run` | ✅ | `maludb_skill_reindex_claim/_apply` |
| Refresh embeddings | `POST /v1/memory/embeddings/run` | ✅ | `embedding_dirty_claim/_complete` |
| Read claims for detection | `GET /v1/statements` | ✅ | (read) `malu$svpor_statement` |
| Invalidate an edge | `PATCH /v1/statements/{id}` | ✅ | close/set `valid_to`, provenance |
| Persist contradiction | `POST/GET /v1/contradictions` | ➕ B.1 | `malu$fact_claim role='contradicts'`, `set_maut_score` |
| Human review queue | `POST/GET/POST .../resolve /v1/reviews` | ➕ B.2 (notes fallback) | `malu$pending_claim` / notes-as-issue |
| Stale / archive / retire | `POST .../lifecycle` | ➕ B.3 | `apply_lifecycle_state`, `propagate_staleness` |
| Downrank / score | `POST .../score` | ➕ B.3 | `set_maut_score`, `record_reinforcement` |
| Retention candidates | `GET /v1/memory/retention-candidates` | ➕ B.3 | `retention_candidates` |
| Consolidate | `POST /v1/memory/consolidate` | ➕ B.4 | `consolidate_memories` |
| Scored candidates | `GET /v1/memory/candidates` | ➕ B.5 | MAUT + salience + watermarks |
| Provenance in one call | `GET .../provenance` | ➕ B.6 | derivation_ledger + sources + supersession |

✅ = build against now · ➕ = new PR on maludb-python-api-server (thin Core proxy)
