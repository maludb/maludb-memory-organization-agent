# Policies

A **policy** is the per-tenant configuration that decides what the agent does, how often, in what priority, and with what guardrails. Policies are data, not code: changing tenant behavior means editing a policy, not the agent. Policies are written in YAML, validated against a schema (Zod, mirrored from this document), versioned, and stored in the operational DB. The version used is stamped on every job run.

## 1. Principles

- **Default + overrides.** A `default` policy applies to any tenant without its own. A tenant policy is a sparse override on top of the default; the *effective policy* is the merge.
- **Validated before use.** A policy that fails validation is never run. Ranges are bounded; unknown keys are rejected.
- **Safe by default.** Anything destructive (archive, retire, downrank, retract, auto-resolve contradictions) is **off** unless explicitly enabled. When off, the agent produces review items instead of acting.
- **Cost-bounded.** Every policy carries daily caps on model calls and tokens. Workers check the cap before spending.

## 2. Top-level shape

```yaml
tenant: default                # "default" or a tenant id
memory_policy_version: 1        # integer, bumped on any change; recorded on each run

priorities: { ... }            # domain weighting + scoring weights
schedules: { ... }             # cadence per job type
reindex: { ... }               # memory.reindex.sweep params
skills_reindex: { ... }        # skills.reindex.sweep params
embeddings: { ... }            # embeddings.drain params
consolidation: { ... }         # memory.consolidation.scan (endpoint-gated)
contradictions: { ... }        # memory.contradiction.scan
lifecycle: { ... }             # stale / archive / downrank rules (endpoint-gated)
cost_controls: { ... }         # per-day model/token caps + local-model preference
models: { ... }                # provider/model preferences for agent-side calls
review: { ... }                # what requires human review
```

## 3. Sections

### 3.1 `priorities`
Domain weights bias scoring toward what this tenant cares about. `scoring` exposes the weights of the prioritization formula (§4) so tenants can tune it without code changes.

```yaml
priorities:
  domains:
    - { name: architecture,        weight: 1.5 }
    - { name: user_preferences,    weight: 1.3 }
    - { name: transient_debugging, weight: 0.5 }
  default_domain_weight: 1.0
  scoring:                      # weights for the priority formula (all optional; sane defaults applied)
    staleness: 1.0
    retrieval_frequency: 1.0
    domain: 1.0
    low_confidence: 1.0
    contradiction: 1.5
    model_version_change: 0.75
    recent_failure_penalty: 1.0
    low_value_decay: 1.0
```

> "Domain" maps to whatever subject/type signal the API exposes (subject type, tags). Until `GET /v1/memory/candidates` lands, domain weighting is applied to whatever subjects the agent enumerates from `/v1/statements`.

### 3.2 `schedules`
Cadence per job type. Cron or interval; translated to BullMQ repeatable jobs per tenant.

```yaml
schedules:
  tenant.healthcheck:        { every: "5m" }
  policy.evaluate:           { every: "1h" }
  memory.reindex.sweep:      { cron: "0 * * * *" }   # hourly
  skills.reindex.sweep:      { cron: "30 2 * * *" }  # daily 02:30
  embeddings.drain:          { every: "10m" }
  memory.contradiction.scan: { cron: "0 3 * * *" }   # daily 03:00
  memory.consolidation.scan: { enabled: false }      # off until endpoint lands
```

### 3.3 `reindex` → `memory.reindex.sweep`
```yaml
reindex:
  default_max_age_days: 30
  high_priority_max_age_days: 7
  low_priority_max_age_days: 90
  batch_limit: 32            # per-call limit (API caps at 200)
  max_batches_per_run: 50    # loop cap so one run can't run forever
  source_type: null          # optional filter passed through to the endpoint
```
`max_age` sent to the endpoint is chosen from the priority tier the run targets (high/default/low). `batch_limit` is the per-call `limit`; the worker loops until `claimed == 0` or `max_batches_per_run`.

### 3.4 `skills_reindex` → `skills.reindex.sweep`
```yaml
skills_reindex:
  max_age_days: 30
  batch_limit: 32
  max_batches_per_run: 20
```

### 3.5 `embeddings` → `embeddings.drain`
```yaml
embeddings:
  batch_limit: 64            # API caps at 512
  kinds: [subject, verb]     # entity-card kinds to drain; omit for all
  max_batches_per_run: 50
```

### 3.6 `contradictions` → `memory.contradiction.scan`
```yaml
contradictions:
  detect: true
  auto_resolve: false        # if true (NOT default), the agent may retract the loser; otherwise review only
  create_review_items: true
  min_confidence_to_flag: 0.6
  max_subjects_per_run: 200  # bounds model spend
  group_by: [subject, verb, predicate]
```

### 3.7 `consolidation` → `memory.consolidation.scan` (endpoint-gated)
```yaml
consolidation:
  enabled: false             # requires POST /v1/memory/consolidate (api-contract B.4)
  min_related_memories: 4
  preserve_source_links: true
  create_summary_claims: true
  require_review: true       # propose, don't auto-merge
```

### 3.8 `lifecycle` (endpoint-gated)
```yaml
lifecycle:
  staleness:
    enabled: false           # requires POST .../lifecycle (api-contract B.3)
    stale_after_days: 180
    auto_mark_stale: true     # marking stale is non-destructive → may be automated
  archival:
    enabled: false
    archive_after_days: 365
    require_review: true      # archival is reversible but gated by default
  retirement:
    enabled: false
    require_review: true      # destructive → always review
  downrank:
    enabled: false
    low_value_score_threshold: 0.2
    require_review: false      # score adjustment only; never deletes
```

### 3.9 `cost_controls`
```yaml
cost_controls:
  max_model_calls_per_day: 500
  max_tokens_per_day: 1000000
  prefer_local_models_for_low_priority: true
  on_budget_exhausted: defer  # defer | skip  (defer reschedules next window)
```
Enforced by the worker before each agent-side model call; spend recorded in `cost_records`. Sweeps don't count (model calls happen server-side inside MaluDB).

### 3.10 `models`
Preferences for **agent-side** model calls (contradiction detection, future consolidation summaries). Provider-neutral; resolved by `model-adapters`.
```yaml
models:
  default:     { provider: anthropic,         model: claude-haiku-4-5 }
  low_priority:{ provider: ollama,            model: llama3.1 }
  high_quality:{ provider: anthropic,         model: claude-opus-4-8 }
```

### 3.11 `review`
What must go through human review regardless of the above.
```yaml
review:
  required_for: [retirement, consolidation, contradiction_resolution]
  reviewer_queue: default
  fallback_to_notes_issue: true   # use /v1/notes type=issue until /v1/reviews lands
```

## 4. Prioritization scoring (the formula)

The policy engine exposes a pure scoring function (unit-tested) used by `policy.evaluate` to rank what to work on:

```
priority_score =
    w.staleness            * staleness_score
  + w.retrieval_frequency  * retrieval_frequency_score
  + w.domain               * policy_domain_score
  + w.low_confidence       * low_confidence_score
  + w.contradiction        * contradiction_score
  + w.model_version_change * model_version_change_score
  - w.recent_failure_penalty * recent_failure_penalty
  - w.low_value_decay      * low_value_decay_score
```

- Weights `w.*` come from `priorities.scoring` (§3.1); each defaults to 1.0 (contradiction 1.5).
- Each sub-score is normalized to `[0,1]` from API-visible signals only:
  - `staleness_score` ← age vs. policy thresholds / `stale_after` / `last_indexed` watermark.
  - `retrieval_frequency_score` ← salience / reinforcement signals where exposed (else 0).
  - `policy_domain_score` ← matched domain weight, rescaled.
  - `low_confidence_score` ← `1 - confidence` from statements/MAUT.
  - `contradiction_score` ← presence/severity of detected contradictions.
  - `model_version_change_score` ← embedding/extract model differs from current registry model.
  - `recent_failure_penalty` ← recent failed runs for that object/tenant (from `job_runs`).
  - `low_value_decay_score` ← decay for never-retrieved, low-confidence, old items.
- V1 ships a deliberately simple, transparent implementation with tests; weights make it tunable without redeploys.

## 5. Validation & versioning

- The schema lives in `packages/policy-engine/src/schema.ts` (Zod) and is the executable form of this document.
- Loading: parse YAML → validate → on success, store with `memory_policy_version` in `policies`. On failure, return actionable errors and refuse to run.
- Effective policy = `default` deep-merged with the tenant override; the merged, validated object is what workers read.
- Changing any field requires bumping `memory_policy_version`; the version is recorded on every `job_run` for auditability.

See `examples/policies/` for `default-policy.yaml`, `life-coach-policy.yaml`, and `developer-memory-policy.yaml`.
