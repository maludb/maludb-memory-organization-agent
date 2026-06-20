import { completeJobRun, createJobRun } from "@maludb-agent/agent-db";
import { JOB_TYPES, parseJobPayload, type JobType } from "@maludb-agent/job-contracts";
import { Worker, type ConnectionOptions, type Job } from "bullmq";

import { buildContext, type JobContext, type WorkerDeps } from "../context.js";
import { tenantHealthcheck } from "../handlers/healthcheck.js";
import { policyEvaluate } from "../handlers/policy-evaluate.js";
import { consolidationScan, contradictionScan } from "../handlers/scans.js";
import { embeddingsDrain, memoryReindexSweep, skillsReindexSweep } from "../handlers/sweeps.js";
import { errMessage, nowIso } from "../handlers/util.js";

/** Route a job to its handler, parsing the payload to its exact type per case. */
async function dispatch(ctx: JobContext, jobType: JobType, raw: unknown): Promise<unknown> {
  switch (jobType) {
    case "tenant.healthcheck":
      return tenantHealthcheck(ctx);
    case "policy.evaluate":
      return policyEvaluate(ctx);
    case "memory.reindex.sweep":
      return memoryReindexSweep(ctx, parseJobPayload(jobType, raw));
    case "skills.reindex.sweep":
      return skillsReindexSweep(ctx, parseJobPayload(jobType, raw));
    case "embeddings.drain":
      return embeddingsDrain(ctx, parseJobPayload(jobType, raw));
    case "memory.contradiction.scan":
      return contradictionScan(ctx, parseJobPayload(jobType, raw));
    case "memory.consolidation.scan":
      return consolidationScan(ctx);
  }
  throw new Error(`unhandled job type: ${String(jobType)}`);
}

/** A result with capabilityUnavailable=true means the run is recorded as skipped. */
function isSkipped(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { capabilityUnavailable?: unknown }).capabilityUnavailable === true
  );
}

/** Execute a job with run recording + lifecycle events around the handler. */
async function runJob(deps: WorkerDeps, jobType: JobType, job: Job): Promise<unknown> {
  const meta = parseJobPayload(jobType, job.data);
  const jobId = String(job.id ?? "");
  const ctx = await buildContext(deps, meta.tenantId, jobId);

  const run = await createJobRun(ctx.db, {
    tenantId: ctx.tenant.id,
    jobType,
    status: "running",
    trigger: meta.trigger,
    policyVersion: meta.policyVersion,
    inputs: job.data,
    bullJobId: jobId,
  });
  const event = { tenantId: ctx.tenant.id, jobType, jobId: run.id };
  ctx.sink.emit({ event: "job.started", ...event, at: nowIso() });

  const attempt = job.attemptsMade + 1;
  try {
    const result = await dispatch(ctx, jobType, job.data);
    const skipped = isSkipped(result);
    await completeJobRun(ctx.db, run.id, {
      status: skipped ? "skipped" : "succeeded",
      outputs: result,
      attempts: attempt,
    });
    ctx.sink.emit(
      skipped
        ? { event: "job.skipped", ...event, at: nowIso(), reason: "capability_unavailable" }
        : { event: "job.succeeded", ...event, at: nowIso() },
    );
    return result;
  } catch (err) {
    const willRetry = attempt < (job.opts.attempts ?? 1);
    await completeJobRun(ctx.db, run.id, {
      status: "failed",
      error: errMessage(err),
      attempts: attempt,
    });
    ctx.sink.emit({
      event: "job.failed",
      ...event,
      at: nowIso(),
      error: errMessage(err),
      attempt,
      willRetry,
    });
    throw err; // let BullMQ apply its retry/backoff policy
  }
}

/** Start one BullMQ worker per job type (one queue per type). */
export function createWorkers(deps: WorkerDeps, connection: ConnectionOptions): Worker[] {
  return JOB_TYPES.map(
    (jobType) =>
      new Worker(jobType, (job: Job) => runJob(deps, jobType, job), {
        connection,
        concurrency: deps.concurrency,
      }),
  );
}
