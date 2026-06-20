import { JOB_TYPES, type JobType } from "@maludb-agent/job-contracts";
import { Queue, type ConnectionOptions } from "bullmq";

/** BullMQ producers — one queue per job type (same queues the worker consumes). */
export function createQueues(connection: ConnectionOptions): Record<JobType, Queue> {
  const entries = JOB_TYPES.map((name) => [name, new Queue(name, { connection })] as const);
  return Object.fromEntries(entries) as Record<JobType, Queue>;
}
