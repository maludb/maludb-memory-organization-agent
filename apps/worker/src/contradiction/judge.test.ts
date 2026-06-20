import type { ModelAdapter, ModelRequest, ModelResponse } from "@maludb-agent/model-adapters";
import type { Statement } from "@maludb-agent/maludb-client";
import { describe, expect, it } from "vitest";

import type { ConflictGroup } from "./detect.js";
import { buildJudgePrompt, judgeConflict, parseVerdict } from "./judge.js";

const group: ConflictGroup = {
  subjectId: 1,
  verbId: 2,
  predicateId: null,
  statements: [
    { id: 1, object_id: 10 } as Statement,
    { id: 2, object_id: 20 } as Statement,
  ],
};

describe("parseVerdict", () => {
  it("parses a clean JSON verdict", () => {
    expect(parseVerdict('{"contradiction": true, "confidence": 0.9, "rationale": "x"}')).toEqual({
      contradiction: true,
      confidence: 0.9,
      rationale: "x",
    });
  });

  it("extracts JSON embedded in surrounding text", () => {
    const v = parseVerdict('Here is my answer: {"contradiction": false, "confidence": 0.2, "rationale": "ok"} done');
    expect(v.contradiction).toBe(false);
    expect(v.confidence).toBe(0.2);
  });

  it("clamps confidence to [0,1]", () => {
    expect(parseVerdict('{"contradiction": true, "confidence": 5}').confidence).toBe(1);
  });

  it("falls back safely on unparseable text", () => {
    expect(parseVerdict("no json here")).toEqual({
      contradiction: false,
      confidence: 0,
      rationale: "unparseable model response",
    });
  });
});

describe("buildJudgePrompt", () => {
  it("includes the subject label and asks for JSON only", () => {
    const prompt = buildJudgePrompt(group, "Alice");
    expect(prompt).toContain('Subject "Alice"');
    expect(prompt).toContain("contradiction");
  });
});

describe("judgeConflict", () => {
  it("returns the parsed verdict and token usage from the adapter", async () => {
    const adapter: ModelAdapter = {
      provider: "fake",
      model: "fake-1",
      complete: async (_req: ModelRequest): Promise<ModelResponse> => ({
        text: '{"contradiction": true, "confidence": 0.8, "rationale": "mutually exclusive"}',
        inputTokens: 30,
        outputTokens: 12,
      }),
    };
    const result = await judgeConflict(adapter, group, "Alice");
    expect(result.verdict).toEqual({ contradiction: true, confidence: 0.8, rationale: "mutually exclusive" });
    expect(result.inputTokens).toBe(30);
    expect(result.outputTokens).toBe(12);
  });
});
