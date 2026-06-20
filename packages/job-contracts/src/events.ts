import { z } from "zod";

import { jobTypeSchema } from "./common.js";

/** Job lifecycle event names, emitted through the observability package. */
export const JOB_EVENTS = [
  "job.started",
  "job.succeeded",
  "job.failed",
  "job.skipped",
  "batch.completed",
] as const;

export type JobEventName = (typeof JOB_EVENTS)[number];

/** Fields shared by every lifecycle event. */
const eventCommon = {
  tenantId: z.string().min(1),
  jobType: jobTypeSchema,
  jobId: z.string().optional(),
  /** ISO-8601 timestamp. */
  at: z.string().datetime(),
};

export const jobStartedEvent = z.object({ event: z.literal("job.started"), ...eventCommon });

export const jobSucceededEvent = z.object({
  event: z.literal("job.succeeded"),
  ...eventCommon,
  durationMs: z.number().nonnegative().optional(),
});

export const jobFailedEvent = z.object({
  event: z.literal("job.failed"),
  ...eventCommon,
  error: z.string(),
  attempt: z.number().int().nonnegative(),
  willRetry: z.boolean(),
});

export const jobSkippedEvent = z.object({
  event: z.literal("job.skipped"),
  ...eventCommon,
  reason: z.string(),
});

export const batchCompletedEvent = z.object({
  event: z.literal("batch.completed"),
  ...eventCommon,
  batchIndex: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
});

/** Discriminated union of all lifecycle events, keyed on `event`. */
export const jobEventSchema = z.discriminatedUnion("event", [
  jobStartedEvent,
  jobSucceededEvent,
  jobFailedEvent,
  jobSkippedEvent,
  batchCompletedEvent,
]);

export type JobEvent = z.infer<typeof jobEventSchema>;

/** Parse + validate a lifecycle event. Throws on invalid input. */
export function parseJobEvent(data: unknown): JobEvent {
  return jobEventSchema.parse(data);
}
