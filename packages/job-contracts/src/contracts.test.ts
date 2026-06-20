import { describe, expect, it } from "vitest";

import { jobContracts, parseJobPayload, parseJobResult, safeParseJobPayload } from "./contracts.js";
import { JOB_TYPES } from "./job-types.js";

describe("jobContracts registry", () => {
  it("has a payload + result schema for every job type", () => {
    for (const jobType of JOB_TYPES) {
      expect(jobContracts[jobType]?.payload).toBeDefined();
      expect(jobContracts[jobType]?.result).toBeDefined();
    }
  });
});

describe("parseJobPayload", () => {
  it("applies documented defaults for a reindex sweep", () => {
    const payload = parseJobPayload("memory.reindex.sweep", { tenantId: "acme" });
    expect(payload).toMatchObject({
      tenantId: "acme",
      trigger: "schedule",
      limit: 32,
      maxAge: "30 days",
      maxBatchesPerRun: 50,
    });
  });

  it("defaults contradiction-scan guardrails", () => {
    const payload = parseJobPayload("memory.contradiction.scan", { tenantId: "acme" });
    expect(payload.autoResolve).toBe(false);
    expect(payload.createReviewItems).toBe(true);
    expect(payload.groupBy).toEqual(["subject", "verb", "predicate"]);
    expect(payload.minConfidenceToFlag).toBe(0.6);
  });

  it("rejects a payload missing tenantId", () => {
    expect(() => parseJobPayload("tenant.healthcheck", {})).toThrow();
  });

  it("enforces the API limit cap for embeddings.drain", () => {
    const ok = safeParseJobPayload("embeddings.drain", { tenantId: "acme", limit: 512 });
    const tooBig = safeParseJobPayload("embeddings.drain", { tenantId: "acme", limit: 513 });
    expect(ok.success).toBe(true);
    expect(tooBig.success).toBe(false);
  });
});

describe("parseJobResult", () => {
  it("validates a reindex sweep result and defaults skippedTotal", () => {
    const result = parseJobResult("memory.reindex.sweep", {
      batches: 3,
      claimedTotal: 90,
      reindexedTotal: 88,
    });
    expect(result).toMatchObject({ batches: 3, reindexedTotal: 88, skippedTotal: 0, errors: [] });
    expect(result.capabilityUnavailable).toBe(false);
  });

  it("rejects negative counts", () => {
    expect(() =>
      parseJobResult("embeddings.drain", { batches: -1, claimedTotal: 0, embeddedTotal: 0 }),
    ).toThrow();
  });
});
