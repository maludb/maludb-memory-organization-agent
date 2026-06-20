import { parsePolicy } from "@maludb-agent/policy-engine";
import { describe, expect, it } from "vitest";

import { parseDuration, planRepeatables } from "./scheduler.js";

const policy = parsePolicy({ tenant: "acme", memory_policy_version: 1 });

describe("parseDuration", () => {
  it("parses supported units", () => {
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("10s")).toBe(10_000);
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  it("rejects an invalid duration", () => {
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("planRepeatables", () => {
  it("schedules healthcheck, policy.evaluate, and enabled sweeps/scan; not disabled consolidation", () => {
    const byType = Object.fromEntries(planRepeatables("acme", policy).map((s) => [s.jobType, s]));
    expect(byType["tenant.healthcheck"]?.repeat).toEqual({ every: 300_000 });
    expect(byType["policy.evaluate"]?.repeat).toEqual({ every: 3_600_000 });
    expect(byType["memory.reindex.sweep"]?.repeat).toEqual({ pattern: "0 * * * *" });
    expect(byType["embeddings.drain"]).toBeDefined();
    expect(byType["memory.contradiction.scan"]).toBeDefined();
    expect(byType["memory.consolidation.scan"]).toBeUndefined();
  });

  it("names jobs per tenant and carries policy-derived params", () => {
    const specs = planRepeatables("acme", policy);
    expect(specs.every((s) => s.name.startsWith("acme:"))).toBe(true);
    const reindex = specs.find((s) => s.jobType === "memory.reindex.sweep");
    expect(reindex?.payload).toMatchObject({
      tenantId: "acme",
      trigger: "schedule",
      limit: 32,
      maxAge: "30 days",
    });
  });
});
