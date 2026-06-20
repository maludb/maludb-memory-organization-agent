import { describe, expect, it } from "vitest";

import { DEFAULT_WEIGHTS, priorityScore, type ScoreComponents } from "./scoring.js";

const zero: ScoreComponents = {
  staleness: 0,
  retrievalFrequency: 0,
  domain: 0,
  lowConfidence: 0,
  contradiction: 0,
  modelVersionChange: 0,
  recentFailurePenalty: 0,
  lowValueDecay: 0,
};

describe("priorityScore", () => {
  it("is zero when all components are zero", () => {
    expect(priorityScore(zero)).toBe(0);
  });

  it("weights contradiction above staleness by default", () => {
    expect(priorityScore({ ...zero, contradiction: 1 })).toBeGreaterThan(
      priorityScore({ ...zero, staleness: 1 }),
    );
  });

  it("subtracts penalties from the score", () => {
    expect(priorityScore({ ...zero, recentFailurePenalty: 1 }, DEFAULT_WEIGHTS)).toBeLessThan(0);
  });

  it("respects custom weights", () => {
    const onlyStaleness: ScoreComponents = { ...zero, staleness: 1 };
    const doubled = { ...DEFAULT_WEIGHTS, staleness: 2 };
    expect(priorityScore(onlyStaleness, doubled)).toBe(2);
  });
});
