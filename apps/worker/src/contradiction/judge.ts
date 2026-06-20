import type { ModelAdapter } from "@maludb-agent/model-adapters";

import type { ConflictGroup } from "./detect.js";

export interface Verdict {
  contradiction: boolean;
  confidence: number;
  rationale: string;
}

/** Build the judging prompt for a candidate conflict group. */
export function buildJudgePrompt(group: ConflictGroup, subjectLabel: string): string {
  const lines = group.statements.map(
    (s, i) =>
      `${i + 1}. object_kind=${s.object_kind ?? "?"} object_id=${s.object_id ?? "?"}` +
      ` confidence=${s.confidence ?? "?"} provenance=${s.provenance ?? "?"} (statement_id=${s.id})`,
  );
  return [
    `Subject "${subjectLabel}" (id=${group.subjectId}) has multiple ACTIVE assertions for the same`,
    `relationship (verb_id=${group.verbId}, predicate_id=${group.predicateId ?? "none"}).`,
    `Decide whether these genuinely CONTRADICT (mutually exclusive truths about the subject) or`,
    `can legitimately coexist (e.g. multiple valid values, or different time periods).`,
    ``,
    `Assertions:`,
    ...lines,
    ``,
    `Reply with ONLY a compact JSON object and nothing else:`,
    `{"contradiction": <true|false>, "confidence": <0..1>, "rationale": "<one sentence>"}`,
  ].join("\n");
}

/** Parse the model's JSON verdict defensively. */
export function parseVerdict(text: string): Verdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { contradiction: false, confidence: 0, rationale: "unparseable model response" };
  try {
    const obj = JSON.parse(match[0]) as Partial<Verdict>;
    const confidence = typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0;
    return {
      contradiction: Boolean(obj.contradiction),
      confidence,
      rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    };
  } catch {
    return { contradiction: false, confidence: 0, rationale: "invalid JSON in model response" };
  }
}

export interface JudgeResult {
  verdict: Verdict;
  inputTokens: number;
  outputTokens: number;
}

/** Ask the model whether a candidate conflict is a real contradiction. */
export async function judgeConflict(
  adapter: ModelAdapter,
  group: ConflictGroup,
  subjectLabel: string,
): Promise<JudgeResult> {
  const res = await adapter.complete({
    messages: [
      {
        role: "system",
        content: "You are a precise data-quality auditor for a knowledge graph. Answer only with the requested JSON.",
      },
      { role: "user", content: buildJudgePrompt(group, subjectLabel) },
    ],
    maxTokens: 256,
  });
  return { verdict: parseVerdict(res.text), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
