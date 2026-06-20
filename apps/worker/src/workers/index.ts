import { JOB_TYPES } from "@maludb-agent/job-contracts";
import type { Logger } from "@maludb-agent/observability";
import { Worker, type ConnectionOptions } from "bullmq";

/**
 * Register one BullMQ worker per job type. Scaffold: handlers just log.
 * Real handlers (load tenant + policy + token, call maludb-client, record runs)
 * are implemented per docs/worker-design.md.
 */
export function createWorkers(connection: ConnectionOptions, log: Logger): Worker[] {
  return JOB_TYPES.map(
    (name) =>
      new Worker(
        name,
        async (job) => {
          log.info({ jobType: name, jobId: job.id }, "received job (scaffold handler)");
          // TODO: dispatch to the handler for this job type.
        },
        { connection },
      ),
  );
}
