import { CapabilityUnavailableError } from "@maludb-agent/maludb-client";
import { describe, expect, it } from "vitest";

import { runSweep, type SweepBatchOutcome } from "./sweep-runner.js";

const outcome = (claimed: number, processed = claimed): SweepBatchOutcome => ({
  claimed,
  processed,
  errors: [],
});

describe("runSweep", () => {
  it("drains when a batch claims zero", async () => {
    const claims = [5, 5, 0];
    const res = await runSweep(async (i) => outcome(claims[i]!), { maxBatches: 10 });
    expect(res.batches).toBe(3);
    expect(res.claimedTotal).toBe(10);
    expect(res.processedTotal).toBe(10);
    expect(res.stoppedReason).toBe("drained");
    expect(res.capabilityUnavailable).toBe(false);
  });

  it("stops at maxBatches when never drained", async () => {
    const res = await runSweep(async () => outcome(5), { maxBatches: 3 });
    expect(res.batches).toBe(3);
    expect(res.stoppedReason).toBe("max_batches");
  });

  it("ends as capability-unavailable on a 501", async () => {
    const res = await runSweep(
      async () => {
        throw new CapabilityUnavailableError("/v1/x");
      },
      { maxBatches: 5 },
    );
    expect(res.capabilityUnavailable).toBe(true);
    expect(res.stoppedReason).toBe("capability_unavailable");
    expect(res.batches).toBe(0);
  });

  it("rethrows non-capability errors", async () => {
    await expect(
      runSweep(
        async () => {
          throw new Error("boom");
        },
        { maxBatches: 5 },
      ),
    ).rejects.toThrow("boom");
  });

  it("aggregates errors and skipped counts and calls onBatch per batch", async () => {
    const seen: number[] = [];
    const res = await runSweep(
      async (i) => ({ claimed: i === 0 ? 3 : 0, processed: 2, skipped: 1, errors: i === 0 ? ["e"] : [] }),
      { maxBatches: 5, onBatch: (i) => void seen.push(i) },
    );
    expect(res.errors).toEqual(["e"]);
    expect(res.skippedTotal).toBe(2);
    expect(seen).toEqual([0, 1]);
  });
});
