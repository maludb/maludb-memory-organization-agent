import type { JobEvent } from "@maludb-agent/job-contracts";

import type { Logger } from "./logger.js";
import { noopMetrics, type Metrics } from "./metrics.js";

/** Sink for job lifecycle events — the single place they become logs + metrics. */
export interface JobEventSink {
  emit(event: JobEvent): void;
}

/**
 * Route job lifecycle events to the logger (at a level matching severity) and to a
 * metrics counter tagged by job type. Workers/the control API emit through this so
 * observability of a run is consistent and centralized (docs/requirements.md OR-3/OR-4).
 */
export function createJobEventSink(logger: Logger, metrics: Metrics = noopMetrics): JobEventSink {
  return {
    emit(event: JobEvent): void {
      const base = { jobType: event.jobType, tenantId: event.tenantId, jobId: event.jobId };
      const tags = { jobType: event.jobType, event: event.event };
      metrics.increment("agent.job.event", 1, tags);

      switch (event.event) {
        case "job.started":
          logger.info(base, "job started");
          break;
        case "job.succeeded":
          logger.info({ ...base, durationMs: event.durationMs }, "job succeeded");
          break;
        case "job.failed":
          logger.error(
            { ...base, err: event.error, attempt: event.attempt, willRetry: event.willRetry },
            "job failed",
          );
          break;
        case "job.skipped":
          logger.warn({ ...base, reason: event.reason }, "job skipped");
          break;
        case "batch.completed":
          logger.debug({ ...base, batchIndex: event.batchIndex, claimed: event.claimed }, "batch completed");
          break;
      }
    },
  };
}
