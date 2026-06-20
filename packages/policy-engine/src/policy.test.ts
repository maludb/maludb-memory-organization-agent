import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadOverrideFile, loadPolicyFile } from "./loader.js";
import { deepMerge, resolveEffectivePolicy } from "./merge.js";
import { parsePolicy, safeParsePolicy } from "./schema.js";

const examples = (name: string): string =>
  fileURLToPath(new URL(`../../../examples/policies/${name}`, import.meta.url));

describe("parsePolicy", () => {
  it("fills defaults for a minimal policy", () => {
    const policy = parsePolicy({ tenant: "acme", memory_policy_version: 1 });
    expect(policy.reindex.batch_limit).toBe(32);
    expect(policy.contradictions.detect).toBe(true);
    expect(policy.contradictions.auto_resolve).toBe(false);
    expect(policy.priorities.scoring.contradiction).toBe(1.5);
    expect(policy.models.default.provider).toBe("anthropic");
    expect(policy.cost_controls.on_budget_exhausted).toBe("defer");
  });

  it("rejects a policy missing required fields", () => {
    expect(safeParsePolicy({ memory_policy_version: 1 }).success).toBe(false);
    expect(safeParsePolicy({ tenant: "acme" }).success).toBe(false);
  });

  it("rejects out-of-range and wrong-typed values", () => {
    expect(
      safeParsePolicy({ tenant: "acme", memory_policy_version: "one" }).success,
    ).toBe(false);
    expect(
      safeParsePolicy({
        tenant: "acme",
        memory_policy_version: 1,
        contradictions: { min_confidence_to_flag: 2 },
      }).success,
    ).toBe(false);
    expect(
      safeParsePolicy({
        tenant: "acme",
        memory_policy_version: 1,
        reindex: { batch_limit: 999 },
      }).success,
    ).toBe(false);
  });

  it("rejects a schedule entry with neither cron nor every (unless disabled)", () => {
    expect(
      safeParsePolicy({
        tenant: "acme",
        memory_policy_version: 1,
        schedules: { "embeddings.drain": {} },
      }).success,
    ).toBe(false);
    expect(
      safeParsePolicy({
        tenant: "acme",
        memory_policy_version: 1,
        schedules: { "embeddings.drain": { enabled: false } },
      }).success,
    ).toBe(true);
  });
});

describe("example policy files", () => {
  it("default-policy.yaml is a complete, valid policy", () => {
    const policy = loadPolicyFile(examples("default-policy.yaml"));
    expect(policy.tenant).toBe("default");
    expect(policy.schedules["memory.consolidation.scan"]?.enabled).toBe(false);
  });

  it("life-coach and developer overrides validate when merged onto the default", () => {
    const base = loadPolicyFile(examples("default-policy.yaml"));
    for (const name of ["life-coach-policy.yaml", "developer-memory-policy.yaml"]) {
      const effective = resolveEffectivePolicy(base, loadOverrideFile(examples(name)));
      expect(effective.memory_policy_version).toBeGreaterThan(0);
    }
  });
});

describe("resolveEffectivePolicy", () => {
  const base = parsePolicy({ tenant: "default", memory_policy_version: 1 });

  it("returns the default unchanged when there is no override", () => {
    expect(resolveEffectivePolicy(base)).toEqual(base);
  });

  it("applies a sparse override and inherits the rest from the default", () => {
    const effective = resolveEffectivePolicy(base, {
      tenant: "life-coach",
      priorities: { scoring: { contradiction: 2 } },
      schedules: { "skills.reindex.sweep": { enabled: false } },
    });
    expect(effective.tenant).toBe("life-coach");
    expect(effective.priorities.scoring.contradiction).toBe(2); // overridden
    expect(effective.priorities.scoring.staleness).toBe(1); // inherited default
    expect(effective.schedules["skills.reindex.sweep"]?.enabled).toBe(false);
    expect(effective.reindex.batch_limit).toBe(32); // untouched section inherited
  });
});

describe("deepMerge", () => {
  it("recurses objects, replaces arrays and scalars, ignores undefined", () => {
    const merged = deepMerge(
      { a: { x: 1, y: 2 }, list: [1, 2, 3], keep: "base" },
      { a: { y: 9 }, list: [9], keep: undefined },
    );
    expect(merged).toEqual({ a: { x: 1, y: 9 }, list: [9], keep: "base" });
  });
});
