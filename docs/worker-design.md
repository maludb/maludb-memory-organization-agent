# Worker Design

Each background job type, specified the same way: **purpose · trigger · inputs · outputs · API calls · failure behavior · retry · idempotency**. Job-type names here are canonical and match `packages/job-contracts`.

## Conventions for every worker

- **Tenant-scoped.** A job carries a `tenant_id`. The worker loads the tenant record, resolves its bearer token from the secret reference, and resolves the *effective policy* before doing anything.
- **Run record.** On start, insert a `job_runs` row (`status=running`, `policy_version`, `inputs`). On finish, update `status`, `outputs`, `error`, timing, retry count.
- **Capability check.** If the worker depends on a Part-B endpoint (see `api-contract.md`), it consults the tenant capability map first; if absent, it finishes with `status=skipped (capability_unavailable)` rather than failing.
- **Transient vs terminal.** Timeouts / 5xx → transient → BullMQ retry with backoff. `4xx` (except 429) → terminal → fail with the parsed `{error.code}`. `501` → capability unavailable → skip.
- **Lifecycle events.** Emit `job.started`, `job.succeeded`, `job.failed`, `job.skipped`, `batch.completed` via `observability`.

---

## 1. `tenant.healthcheck`

- **Purpose.** Confirm a tenant is reachable and configured before other jobs run; build/refresh the capability map.
- **Trigger.** Scheduled (`schedules.tenant.healthcheck`, e.g. every 5m) and on tenant create/enable.
- **Inputs.** `tenant_id`.
- **Outputs.** `{healthy, config_ok, capabilities:{...}, warnings:[...]}` persisted to the tenant record.
- **API calls.** `GET /health`; `GET /v1/memory/config`; `GET /openapi.json` (+ optional idempotent trial reads) to populate capabilities. Surfaces `model_not_configured` / `model_api_key_missing` as warnings.
- **Failure.** Unreachable → mark tenant `unhealthy`; downstream schedulers skip it until healthy again.
- **Retry.** Short backoff, few attempts; health is re-probed on the next schedule regardless.
- **Idempotency.** Pure read; fully idempotent.

## 2. `policy.evaluate`

- **Purpose.** Turn the effective policy + current tenant state into prioritized work; decide which sweeps/scans to enqueue and with what parameters.
- **Trigger.** Scheduled (`schedules.policy.evaluate`, e.g. hourly) and on policy change.
- **Inputs.** `tenant_id`, effective policy.
- **Outputs.** A set of enqueued child jobs + a ranked candidate summary recorded for explainability.
- **API calls.** Read-only: `GET /v1/statements`, `GET /v1/subjects`, and (when available) `GET /v1/memory/candidates`. No writes.
- **Logic.** Runs the prioritization scoring (policies.md §4) over enumerated candidates; chooses priority tiers (high/default/low) → maps to `max_age`/batch params; enqueues `memory.reindex.sweep`, `embeddings.drain`, `memory.contradiction.scan`, etc. as policy enables.
- **Failure.** If reads fail, no work is enqueued this cycle (safe no-op); recorded as failed run.
- **Retry.** Idempotent re-run is safe (it re-evaluates current state); BullMQ retry ok.
- **Idempotency.** Child jobs use deterministic job ids per `(tenant, job_type, window)` so a duplicate evaluate doesn't double-enqueue the same window.

## 3. `memory.reindex.sweep`

- **Purpose.** Drain the document/note reindex queue under policy pacing.
- **Trigger.** Scheduled and via `policy.evaluate` / manual control-API trigger.
- **Inputs.** `tenant_id`, `{limit, max_age, source_type?, max_batches_per_run}` from policy.
- **Outputs.** Aggregated `{batches, claimed_total, reindexed_total, skipped_total, errors[]}` + watermark.
- **API calls.** Loop `POST /v1/memory/reindex/run?limit&max_age&source_type` until `claimed == 0` or `max_batches_per_run`.
- **Failure.** Per-item entries in `errors[]` don't abort the loop. A transient HTTP failure on a batch → retry that batch. `501` → skip (capability unavailable).
- **Retry.** Safe — Core claims with `FOR UPDATE SKIP LOCKED`; re-running re-claims only still-dirty rows.
- **Idempotency.** Natural: the server's claim/apply protocol guarantees no double-processing. Watermark records last batch for resumability.

## 4. `skills.reindex.sweep`

- **Purpose.** Drain the skill reindex queue.
- **Trigger / inputs / outputs.** As §3 but for skills; params from `skills_reindex`.
- **API calls.** Loop `POST /v1/skills/reindex/run?limit&max_age`.
- **Failure / retry / idempotency.** Identical model to §3. `501` if Core < 0.99.0 → skip.

## 5. `embeddings.drain`

- **Purpose.** Drain the entity-card embedding dirty queue (server computes vectors with the tenant's embed model).
- **Trigger / inputs.** Scheduled / from `policy.evaluate`; params from `embeddings` (`batch_limit`, `kinds`, `max_batches_per_run`).
- **Outputs.** `{batches, claimed_total, embedded_total, errors[]}` + watermark.
- **API calls.** Loop `POST /v1/memory/embeddings/run?limit&kinds`.
- **Failure / retry / idempotency.** As §3; Core's `generation`-counter + content-hash skip make re-embeds idempotent and avoid re-spending on unchanged cards. `501` if Core < 0.95.0 → skip.

## 6. `memory.contradiction.scan` (first intelligence worker — ADR-0005)

- **Purpose.** Detect semantically contradicting facts about the same subject and surface them for review (or, only if policy `auto_resolve`, retract the loser). This is the net-new capability Core cannot do itself.
- **Trigger.** Scheduled (`schedules.memory.contradiction.scan`) and via `policy.evaluate`.
- **Inputs.** `tenant_id`, `contradictions` policy block, `models` preferences, cost budget.
- **Outputs.** `{subjects_examined, contradictions_found, review_items_created, model_calls, tokens}`.
- **API calls.**
  1. Read: enumerate candidate subjects (`GET /v1/subjects`, scored), then `GET /v1/statements?subject_id=...` per subject; group by `group_by` (default `subject,verb,predicate`); fetch provenance where useful.
  2. Judge: for each conflicting group, a `model-adapters` call decides contradiction + confidence + rationale. Budget checked first (cost_controls); low-priority groups may use the local model.
  3. Write: `POST /v1/contradictions` and `POST /v1/reviews` (or notes-issue fallback). If `auto_resolve` and confidence ≥ threshold, `PATCH /v1/statements/{id}` to close the losing edge — otherwise review only.
- **Failure.** Read failure → fail run (no writes). Model failure on a group → record per-group error, continue. Write failure → retry the write; never leave a contradiction detected-but-unrecorded silently.
- **Retry.** Safe via dedup key.
- **Idempotency.** Contradiction dedup key = `(tenant, subject, verb, predicate, sorted(statement_ids))`. `POST /v1/contradictions` must be upsert-by-key (api-contract B.1) or the agent checks `GET /v1/contradictions` first. Review items dedupe on the same key. Cost is metered so retries don't blow the daily budget unboundedly.

## 7. `memory.consolidation.scan` (phase 2 — endpoint-gated)

- **Purpose.** Find clusters of related memories and propose merges that preserve provenance.
- **Trigger.** Scheduled, only when `consolidation.enabled` **and** `POST /v1/memory/consolidate` capability present.
- **Inputs.** `tenant_id`, `consolidation` policy block.
- **Outputs.** `{clusters_found, consolidations_proposed, review_items_created}`.
- **API calls.** Read candidates/statements to cluster (similarity via `/v1/memory/search` or future `/v1/memory/candidates`); `POST /v1/reviews` to propose; on review-accept, the API executes `POST /v1/memory/consolidate` (Core `consolidate_memories`). `require_review: true` by default — the agent proposes, it does not auto-merge.
- **Failure / retry / idempotency.** Proposals dedupe on the candidate set hash. No destructive action without an accepted review item.

---

## Scheduling & concurrency notes

- **Repeatable jobs** are created per enabled tenant × job type from `schedules`; changing a policy re-syncs the repeatable set.
- **Per-tenant concurrency** is bounded so one tenant can't starve others; sweeps for the same tenant+type are singleton (no overlapping runs) via deterministic job ids / BullMQ locks.
- **Backoff** is exponential with jitter; transient classification is centralized in `maludb-client`.
- **Graceful shutdown** drains in-flight handlers or returns jobs to the queue; run records are closed as `interrupted` for restartability.
