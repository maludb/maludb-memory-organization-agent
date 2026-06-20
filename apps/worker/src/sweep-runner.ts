import type { StoppedReason } from "@maludb-agent/job-contracts";
import { isCapabilityUnavailable } from "@maludb-agent/maludb-client";

export interface SweepBatchOutcome {
  /** Items claimed by this batch; 0 means the queue is drained. */
  claimed: number;
  /** Items successfully processed (reindexed/embedded) this batch. */
  processed: number;
  /** Items skipped this batch (reindex only). */
  skipped?: number;
  /** Per-item errors reported by the API for this batch. */
  errors: unknown[];
}

export interface SweepRunResult {
  batches: number;
  claimedTotal: number;
  processedTotal: number;
  skippedTotal: number;
  errors: unknown[];
  capabilityUnavailable: boolean;
  stoppedReason: StoppedReason;
}

export interface SweepRunnerOptions {
  maxBatches: number;
  onBatch?: (index: number, outcome: SweepBatchOutcome) => void | Promise<void>;
}

/**
 * Drive a single-batch operation repeatedly until the queue drains or a cap is hit
 * (docs/worker-design.md §3). Pure given `runBatch`, so the looping logic is unit-tested
 * in isolation. A CapabilityUnavailableError (HTTP 501) ends the sweep as "capability
 * unavailable" rather than a failure; other errors propagate (BullMQ handles retry).
 */
export async function runSweep(
  runBatch: (batchIndex: number) => Promise<SweepBatchOutcome>,
  opts: SweepRunnerOptions,
): Promise<SweepRunResult> {
  let batches = 0;
  let claimedTotal = 0;
  let processedTotal = 0;
  let skippedTotal = 0;
  const errors: unknown[] = [];

  let index = 0;
  for (; index < opts.maxBatches; index++) {
    let outcome: SweepBatchOutcome;
    try {
      outcome = await runBatch(index);
    } catch (err) {
      if (isCapabilityUnavailable(err)) {
        return {
          batches,
          claimedTotal,
          processedTotal,
          skippedTotal,
          errors,
          capabilityUnavailable: true,
          stoppedReason: "capability_unavailable",
        };
      }
      throw err;
    }

    batches += 1;
    claimedTotal += outcome.claimed;
    processedTotal += outcome.processed;
    skippedTotal += outcome.skipped ?? 0;
    if (outcome.errors.length > 0) errors.push(...outcome.errors);

    if (opts.onBatch) await opts.onBatch(index, outcome);

    if (outcome.claimed === 0) break; // drained
  }

  return {
    batches,
    claimedTotal,
    processedTotal,
    skippedTotal,
    errors,
    capabilityUnavailable: false,
    stoppedReason: index >= opts.maxBatches ? "max_batches" : "drained",
  };
}
