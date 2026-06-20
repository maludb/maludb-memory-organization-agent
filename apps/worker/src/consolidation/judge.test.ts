import type { MemoryNote } from "@maludb-agent/maludb-client";
import type { ModelAdapter, ModelResponse } from "@maludb-agent/model-adapters";
import { describe, expect, it } from "vitest";

import { buildConsolidationPrompt, judgeConsolidation, parseConsolidationVerdict } from "./judge.js";

const notes: MemoryNote[] = [
  { id: 1, title: "Likes tea", source_type: "note", snippet: "prefers tea", created_at: "2026-06-20T00:00:00.000Z" },
  { id: 2, title: "Tea again", source_type: "note", snippet: "drinks tea daily", created_at: "2026-06-20T00:00:00.000Z" },
];

describe("parseConsolidationVerdict", () => {
  it("parses a merge proposal", () => {
    const v = parseConsolidationVerdict(
      '{"consolidate": true, "confidence": 0.8, "title": "Tea", "summary": "Drinks tea.", "rationale": "dupes"}',
    );
    expect(v).toEqual({
      consolidate: true,
      confidence: 0.8,
      title: "Tea",
      summary: "Drinks tea.",
      rationale: "dupes",
    });
  });

  it("falls back safely on garbage", () => {
    expect(parseConsolidationVerdict("nope").consolidate).toBe(false);
  });
});

describe("buildConsolidationPrompt", () => {
  it("lists memory ids and the subject", () => {
    const prompt = buildConsolidationPrompt("Alice", notes);
    expect(prompt).toContain("memory_id=1");
    expect(prompt).toContain('subject "Alice"');
  });
});

describe("judgeConsolidation", () => {
  it("returns the parsed verdict and usage", async () => {
    const adapter: ModelAdapter = {
      provider: "fake",
      model: "fake-1",
      complete: async (): Promise<ModelResponse> => ({
        text: '{"consolidate": true, "confidence": 0.9, "title": "T", "summary": "S", "rationale": "r"}',
        inputTokens: 40,
        outputTokens: 20,
      }),
    };
    const result = await judgeConsolidation(adapter, "Alice", notes);
    expect(result.verdict.consolidate).toBe(true);
    expect(result.inputTokens).toBe(40);
    expect(result.outputTokens).toBe(20);
  });
});
