/**
 * Canonical job-type identifiers. These exact strings are used as BullMQ queue/job
 * names and recorded on every job_runs row. See docs/worker-design.md.
 */
export const JOB_TYPES = [
  "tenant.healthcheck",
  "policy.evaluate",
  "memory.reindex.sweep",
  "skills.reindex.sweep",
  "embeddings.drain",
  "memory.contradiction.scan",
  "memory.consolidation.scan",
] as const;

export type JobType = (typeof JOB_TYPES)[number];
