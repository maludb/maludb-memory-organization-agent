import { CapabilityUnavailableError, type MaludbClient } from "@maludb-agent/maludb-client";
import { describe, expect, it } from "vitest";

import type { JobContext } from "../context.js";
import { memoryReindexSweep } from "./sweeps.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeCtx(client: Partial<MaludbClient>): JobContext {
  return {
    deps: {} as any,
    db: { query: async () => ({ rows: [], rowCount: 0 }) } as any,
    client: client as MaludbClient,
    tenant: { id: "acme" } as any,
    sink: { emit() {} },
    log: { info() {}, warn() {}, error() {}, debug() {} } as any,
    jobId: "job1",
  };
}

const payload = {
  tenantId: "acme",
  trigger: "schedule" as const,
  limit: 32,
  maxAge: "30 days",
  maxBatchesPerRun: 5,
};

describe("memoryReindexSweep handler", () => {
  it("loops batches until drained and aggregates totals", async () => {
    const batches = [
      { claimed: 2, reindexed: [1, 1], skipped: [1], errors: [] },
      { claimed: 0, reindexed: [], skipped: [], errors: [] },
    ];
    let i = 0;
    const ctx = fakeCtx({ runMemoryReindex: async () => batches[i++]! as any });

    const res = await memoryReindexSweep(ctx, payload);
    expect(res.batches).toBe(2);
    expect(res.claimedTotal).toBe(2);
    expect(res.reindexedTotal).toBe(2);
    expect(res.skippedTotal).toBe(1);
    expect(res.stoppedReason).toBe("drained");
    expect(res.capabilityUnavailable).toBe(false);
  });

  it("reports capabilityUnavailable when the endpoint returns 501", async () => {
    const ctx = fakeCtx({
      runMemoryReindex: async () => {
        throw new CapabilityUnavailableError("/v1/memory/reindex/run");
      },
    });
    const res = await memoryReindexSweep(ctx, payload);
    expect(res.capabilityUnavailable).toBe(true);
  });
});
