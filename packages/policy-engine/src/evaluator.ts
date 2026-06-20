import type { PlannedJob } from "@maludb-agent/job-contracts";

import type { Policy } from "./schema.js";
import type { ScoreWeights } from "./scoring.js";

/** A schedule entry is "active" if it exists and is not explicitly disabled. */
function isActive(entry?: { enabled?: boolean }): boolean {
  return entry !== undefined && entry.enabled !== false;
}

/**
 * Derive the downstream jobs `policy.evaluate` should enqueue from a policy alone (pure;
 * no API calls). A job is planned when its schedule entry is active AND the relevant
 * section enables it. Params are camelCase and match the job-contracts payload schemas
 * (tenantId/trigger are added by the enqueuer). See docs/worker-design.md §2.
 *
 * Candidate *selection* (which subjects/memories) happens inside the scan workers using
 * priorityScore() + weightsFromPolicy() over data fetched from the MaluDB API.
 */
export function planScheduledJobs(policy: Policy): PlannedJob[] {
  const s = policy.schedules;
  const jobs: PlannedJob[] = [];

  if (isActive(s["memory.reindex.sweep"])) {
    jobs.push({
      jobType: "memory.reindex.sweep",
      params: {
        limit: policy.reindex.batch_limit,
        maxAge: `${policy.reindex.default_max_age_days} days`,
        maxBatchesPerRun: policy.reindex.max_batches_per_run,
        ...(policy.reindex.source_type ? { sourceType: policy.reindex.source_type } : {}),
      },
    });
  }

  if (isActive(s["skills.reindex.sweep"])) {
    jobs.push({
      jobType: "skills.reindex.sweep",
      params: {
        limit: policy.skills_reindex.batch_limit,
        maxAge: `${policy.skills_reindex.max_age_days} days`,
        maxBatchesPerRun: policy.skills_reindex.max_batches_per_run,
      },
    });
  }

  if (isActive(s["embeddings.drain"])) {
    jobs.push({
      jobType: "embeddings.drain",
      params: {
        limit: policy.embeddings.batch_limit,
        kinds: policy.embeddings.kinds,
        maxBatchesPerRun: policy.embeddings.max_batches_per_run,
      },
    });
  }

  if (isActive(s["memory.contradiction.scan"]) && policy.contradictions.detect) {
    jobs.push({
      jobType: "memory.contradiction.scan",
      params: {
        maxSubjectsPerRun: policy.contradictions.max_subjects_per_run,
        minConfidenceToFlag: policy.contradictions.min_confidence_to_flag,
        groupBy: policy.contradictions.group_by,
        autoResolve: policy.contradictions.auto_resolve,
        createReviewItems: policy.contradictions.create_review_items,
      },
    });
  }

  if (isActive(s["memory.consolidation.scan"]) && policy.consolidation.enabled) {
    jobs.push({
      jobType: "memory.consolidation.scan",
      params: {
        minRelatedMemories: policy.consolidation.min_related_memories,
        requireReview: policy.consolidation.require_review,
      },
    });
  }

  return jobs;
}

/** Map a policy's snake_case scoring weights to the scoring module's ScoreWeights. */
export function weightsFromPolicy(policy: Policy): ScoreWeights {
  const w = policy.priorities.scoring;
  return {
    staleness: w.staleness,
    retrievalFrequency: w.retrieval_frequency,
    domain: w.domain,
    lowConfidence: w.low_confidence,
    contradiction: w.contradiction,
    modelVersionChange: w.model_version_change,
    recentFailurePenalty: w.recent_failure_penalty,
    lowValueDecay: w.low_value_decay,
  };
}
