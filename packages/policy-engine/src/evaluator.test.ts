import { parseJobPayload, type JobType } from "@maludb-agent/job-contracts";
import { describe, expect, it } from "vitest";

import { planScheduledJobs, weightsFromPolicy } from "./evaluator.js";
import { parsePolicy } from "./schema.js";

const defaultPolicy = parsePolicy({ tenant: "default", memory_policy_version: 1 });

describe("planScheduledJobs", () => {
  it("plans the enabled sweeps and the contradiction scan, not consolidation", () => {
    const jobTypes = planScheduledJobs(defaultPolicy).map((j) => j.jobType);
    expect(jobTypes).toContain("memory.reindex.sweep");
    expect(jobTypes).toContain("skills.reindex.sweep");
    expect(jobTypes).toContain("embeddings.drain");
    expect(jobTypes).toContain("memory.contradiction.scan");
    expect(jobTypes).not.toContain("memory.consolidation.scan");
  });

  it("omits a sweep whose schedule is disabled", () => {
    const policy = parsePolicy({
      tenant: "default",
      memory_policy_version: 1,
      schedules: { "skills.reindex.sweep": { enabled: false } },
    });
    expect(planScheduledJobs(policy).map((j) => j.jobType)).not.toContain("skills.reindex.sweep");
  });

  it("plans consolidation only when enabled and scheduled", () => {
    const policy = parsePolicy({
      tenant: "default",
      memory_policy_version: 1,
      consolidation: { enabled: true },
      schedules: { "memory.consolidation.scan": { cron: "0 5 * * *" } },
    });
    expect(planScheduledJobs(policy).map((j) => j.jobType)).toContain("memory.consolidation.scan");
  });

  it("produces params that satisfy the job-contracts payload schemas", () => {
    for (const job of planScheduledJobs(defaultPolicy)) {
      // tenantId is added by the enqueuer; the rest must validate as-is.
      expect(() =>
        parseJobPayload(job.jobType as JobType, { tenantId: "acme", ...job.params }),
      ).not.toThrow();
    }
  });

  it("derives reindex params from the policy", () => {
    const reindex = planScheduledJobs(defaultPolicy).find((j) => j.jobType === "memory.reindex.sweep");
    expect(reindex?.params).toMatchObject({ limit: 32, maxAge: "30 days", maxBatchesPerRun: 50 });
  });
});

describe("weightsFromPolicy", () => {
  it("maps snake_case policy weights to camelCase ScoreWeights", () => {
    const weights = weightsFromPolicy(defaultPolicy);
    expect(weights.contradiction).toBe(1.5);
    expect(weights.modelVersionChange).toBe(0.75);
    expect(weights.staleness).toBe(1);
  });
});
