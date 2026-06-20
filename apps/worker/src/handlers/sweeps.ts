import { setWatermark } from "@maludb-agent/agent-db";
import type { JobPayload, JobResult, JobType } from "@maludb-agent/job-contracts";

import type { JobContext } from "../context.js";
import { runSweep, type SweepBatchOutcome } from "../sweep-runner.js";
import { asArr, asCount, asNum, nowIso } from "./util.js";

function onBatch(ctx: JobContext, jobType: JobType) {
  return async (index: number, outcome: SweepBatchOutcome): Promise<void> => {
    ctx.sink.emit({
      event: "batch.completed",
      tenantId: ctx.tenant.id,
      jobType,
      jobId: ctx.jobId,
      at: nowIso(),
      batchIndex: index,
      claimed: outcome.claimed,
    });
    await setWatermark(ctx.db, ctx.tenant.id, jobType, { lastBatchIndex: index, claimed: outcome.claimed });
  };
}

export async function memoryReindexSweep(
  ctx: JobContext,
  p: JobPayload<"memory.reindex.sweep">,
): Promise<JobResult<"memory.reindex.sweep">> {
  const res = await runSweep(
    async () => {
      const r = await ctx.client.runMemoryReindex({
        limit: p.limit,
        maxAge: p.maxAge,
        sourceType: p.sourceType,
      });
      return { claimed: asNum(r.claimed), processed: asCount(r.reindexed), skipped: asCount(r.skipped), errors: asArr(r.errors) };
    },
    { maxBatches: p.maxBatchesPerRun, onBatch: onBatch(ctx, "memory.reindex.sweep") },
  );
  return {
    batches: res.batches,
    claimedTotal: res.claimedTotal,
    reindexedTotal: res.processedTotal,
    skippedTotal: res.skippedTotal,
    errors: res.errors,
    capabilityUnavailable: res.capabilityUnavailable,
    stoppedReason: res.stoppedReason,
  };
}

export async function skillsReindexSweep(
  ctx: JobContext,
  p: JobPayload<"skills.reindex.sweep">,
): Promise<JobResult<"skills.reindex.sweep">> {
  const res = await runSweep(
    async () => {
      const r = await ctx.client.runSkillsReindex({ limit: p.limit, maxAge: p.maxAge });
      return { claimed: asNum(r.claimed), processed: asCount(r.reindexed), errors: asArr(r.errors) };
    },
    { maxBatches: p.maxBatchesPerRun, onBatch: onBatch(ctx, "skills.reindex.sweep") },
  );
  return {
    batches: res.batches,
    claimedTotal: res.claimedTotal,
    reindexedTotal: res.processedTotal,
    errors: res.errors,
    capabilityUnavailable: res.capabilityUnavailable,
    stoppedReason: res.stoppedReason,
  };
}

export async function embeddingsDrain(
  ctx: JobContext,
  p: JobPayload<"embeddings.drain">,
): Promise<JobResult<"embeddings.drain">> {
  const res = await runSweep(
    async () => {
      const r = await ctx.client.runEmbeddingsDrain({ limit: p.limit, kinds: p.kinds });
      return { claimed: asNum(r.claimed), processed: asCount(r.embedded), errors: asArr(r.errors) };
    },
    { maxBatches: p.maxBatchesPerRun, onBatch: onBatch(ctx, "embeddings.drain") },
  );
  return {
    batches: res.batches,
    claimedTotal: res.claimedTotal,
    embeddedTotal: res.processedTotal,
    errors: res.errors,
    capabilityUnavailable: res.capabilityUnavailable,
    stoppedReason: res.stoppedReason,
  };
}
