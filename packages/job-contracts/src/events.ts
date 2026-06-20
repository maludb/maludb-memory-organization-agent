/** Job lifecycle event names emitted through the observability package. */
export const JOB_EVENTS = [
  "job.started",
  "job.succeeded",
  "job.failed",
  "job.skipped",
  "batch.completed",
] as const;

export type JobEvent = (typeof JOB_EVENTS)[number];
