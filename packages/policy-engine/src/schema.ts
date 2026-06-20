import { z } from "zod";

/**
 * Policy schema — the executable form of docs/policies.md and the single source of
 * truth for policy shape. Every section has a default so that parsing a minimal policy
 * ({ tenant, memory_policy_version }) yields a complete, validated policy. Tenant
 * override files are sparse; they are deep-merged onto a complete default and the merged
 * result is validated again (see merge.ts / resolveEffectivePolicy).
 *
 * YAML uses snake_case to match the example policy files; the camelCase job payloads are
 * produced by the evaluator.
 */

const domainSchema = z.object({
  name: z.string().min(1),
  weight: z.number().positive(),
});

const scoringWeightsSchema = z
  .object({
    staleness: z.number().default(1),
    retrieval_frequency: z.number().default(1),
    domain: z.number().default(1),
    low_confidence: z.number().default(1),
    contradiction: z.number().default(1.5),
    model_version_change: z.number().default(0.75),
    recent_failure_penalty: z.number().default(1),
    low_value_decay: z.number().default(1),
  })
  .default({});

const prioritiesSchema = z
  .object({
    default_domain_weight: z.number().positive().default(1),
    domains: z.array(domainSchema).default([]),
    scoring: scoringWeightsSchema,
  })
  .default({});

const scheduleEntrySchema = z
  .object({
    enabled: z.boolean().default(true),
    cron: z.string().optional(),
    every: z.string().optional(),
  })
  .refine((e) => e.enabled === false || e.cron !== undefined || e.every !== undefined, {
    message: "schedule entry needs `cron` or `every` unless `enabled: false`",
  });

const schedulesSchema = z
  .object({
    "tenant.healthcheck": scheduleEntrySchema.optional(),
    "policy.evaluate": scheduleEntrySchema.optional(),
    "memory.reindex.sweep": scheduleEntrySchema.optional(),
    "skills.reindex.sweep": scheduleEntrySchema.optional(),
    "embeddings.drain": scheduleEntrySchema.optional(),
    "memory.contradiction.scan": scheduleEntrySchema.optional(),
    "memory.consolidation.scan": scheduleEntrySchema.optional(),
  })
  // Default cadences mirror docs/policies.md so a minimal policy is still functional.
  // Tenant overrides deep-merge onto these per-entry (see merge.ts).
  .default({
    "tenant.healthcheck": { enabled: true, every: "5m" },
    "policy.evaluate": { enabled: true, every: "1h" },
    "memory.reindex.sweep": { enabled: true, cron: "0 * * * *" },
    "skills.reindex.sweep": { enabled: true, cron: "30 2 * * *" },
    "embeddings.drain": { enabled: true, every: "10m" },
    "memory.contradiction.scan": { enabled: true, cron: "0 3 * * *" },
    "memory.consolidation.scan": { enabled: false },
  });

const reindexSchema = z
  .object({
    default_max_age_days: z.number().int().positive().default(30),
    high_priority_max_age_days: z.number().int().positive().default(7),
    low_priority_max_age_days: z.number().int().positive().default(90),
    batch_limit: z.number().int().positive().max(200).default(32),
    max_batches_per_run: z.number().int().positive().default(50),
    source_type: z.string().nullable().default(null),
  })
  .default({});

const skillsReindexSchema = z
  .object({
    max_age_days: z.number().int().positive().default(30),
    batch_limit: z.number().int().positive().max(200).default(32),
    max_batches_per_run: z.number().int().positive().default(20),
  })
  .default({});

const embeddingsSchema = z
  .object({
    batch_limit: z.number().int().positive().max(512).default(64),
    kinds: z.array(z.string()).default(["subject", "verb"]),
    max_batches_per_run: z.number().int().positive().default(50),
  })
  .default({});

const contradictionsSchema = z
  .object({
    detect: z.boolean().default(true),
    auto_resolve: z.boolean().default(false),
    create_review_items: z.boolean().default(true),
    min_confidence_to_flag: z.number().min(0).max(1).default(0.6),
    max_subjects_per_run: z.number().int().positive().default(200),
    group_by: z.array(z.string()).default(["subject", "verb", "predicate"]),
  })
  .default({});

const consolidationSchema = z
  .object({
    enabled: z.boolean().default(false),
    min_related_memories: z.number().int().positive().default(4),
    preserve_source_links: z.boolean().default(true),
    create_summary_claims: z.boolean().default(true),
    require_review: z.boolean().default(true),
  })
  .default({});

const lifecycleSchema = z
  .object({
    staleness: z
      .object({
        enabled: z.boolean().default(false),
        stale_after_days: z.number().int().positive().default(180),
        auto_mark_stale: z.boolean().default(true),
      })
      .default({}),
    archival: z
      .object({
        enabled: z.boolean().default(false),
        archive_after_days: z.number().int().positive().default(365),
        require_review: z.boolean().default(true),
      })
      .default({}),
    retirement: z
      .object({
        enabled: z.boolean().default(false),
        require_review: z.boolean().default(true),
      })
      .default({}),
    downrank: z
      .object({
        enabled: z.boolean().default(false),
        low_value_score_threshold: z.number().min(0).max(1).default(0.2),
        require_review: z.boolean().default(false),
      })
      .default({}),
  })
  .default({});

const costControlsSchema = z
  .object({
    max_model_calls_per_day: z.number().int().nonnegative().default(500),
    max_tokens_per_day: z.number().int().nonnegative().default(1_000_000),
    prefer_local_models_for_low_priority: z.boolean().default(true),
    on_budget_exhausted: z.enum(["defer", "skip"]).default("defer"),
  })
  .default({});

const modelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const modelsSchema = z
  .object({
    default: modelRefSchema.default({ provider: "anthropic", model: "claude-haiku-4-5" }),
    low_priority: modelRefSchema.optional(),
    high_quality: modelRefSchema.optional(),
  })
  .default({});

const reviewSchema = z
  .object({
    required_for: z
      .array(z.string())
      .default(["retirement", "consolidation", "contradiction_resolution"]),
    reviewer_queue: z.string().default("default"),
    fallback_to_notes_issue: z.boolean().default(true),
  })
  .default({});

export const policySchema = z.object({
  tenant: z.string().min(1),
  memory_policy_version: z.number().int().positive(),
  priorities: prioritiesSchema,
  schedules: schedulesSchema,
  reindex: reindexSchema,
  skills_reindex: skillsReindexSchema,
  embeddings: embeddingsSchema,
  contradictions: contradictionsSchema,
  consolidation: consolidationSchema,
  lifecycle: lifecycleSchema,
  cost_controls: costControlsSchema,
  models: modelsSchema,
  review: reviewSchema,
});

export type Policy = z.infer<typeof policySchema>;

/** Parse + validate a raw (already YAML-decoded) policy. Fills defaults. Throws on invalid input. */
export function parsePolicy(raw: unknown): Policy {
  return policySchema.parse(raw);
}

/** Non-throwing variant (returns Zod's SafeParse result). */
export function safeParsePolicy(raw: unknown) {
  return policySchema.safeParse(raw);
}
