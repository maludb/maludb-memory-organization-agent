import { JOB_TYPES, type JobType } from "@maludb-agent/job-contracts";
import { Queue, type ConnectionOptions } from "bullmq";

/** One BullMQ queue per job type; queue names match JobType exactly. */
export function createQueues(connection: ConnectionOptions): Record<JobType, Queue> {
  const entries = JOB_TYPES.map((name) => [name, new Queue(name, { connection })] as const);
  return Object.fromEntries(entries) as Record<JobType, Queue>;
}
