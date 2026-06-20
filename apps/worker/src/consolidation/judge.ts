import type { MemoryNote } from "@maludb-agent/maludb-client";
import type { ModelAdapter } from "@maludb-agent/model-adapters";

export interface ConsolidationVerdict {
  consolidate: boolean;
  confidence: number;
  title: string;
  summary: string;
  rationale: string;
}

/** Prompt the model to decide whether a subject's memories should merge, and propose the merge. */
export function buildConsolidationPrompt(subjectLabel: string, notes: MemoryNote[]): string {
  const lines = notes.map(
    (n, i) => `${i + 1}. (memory_id=${n.id}) ${n.title ?? "(untitled)"} — ${n.snippet ?? ""}`,
  );
  return [
    `These memories all relate to the subject "${subjectLabel}". Decide whether they are`,
    `redundant or overlapping enough to MERGE into a single consolidated memory.`,
    ``,
    `Memories:`,
    ...lines,
    ``,
    `If they should merge, propose a concise consolidated title and a 1-3 sentence summary`,
    `that preserves the key facts. If they cover distinct things, do not merge.`,
    `Reply with ONLY compact JSON and nothing else:`,
    `{"consolidate": <true|false>, "confidence": <0..1>, "title": "<title>", "summary": "<summary>", "rationale": "<one sentence>"}`,
  ].join("\n");
}

const EMPTY: ConsolidationVerdict = {
  consolidate: false,
  confidence: 0,
  title: "",
  summary: "",
  rationale: "unparseable model response",
};

/** Parse the model's JSON consolidation verdict defensively. */
export function parseConsolidationVerdict(text: string): ConsolidationVerdict {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return EMPTY;
  try {
    const o = JSON.parse(match[0]) as Partial<ConsolidationVerdict>;
    return {
      consolidate: Boolean(o.consolidate),
      confidence: typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0,
      title: typeof o.title === "string" ? o.title : "",
      summary: typeof o.summary === "string" ? o.summary : "",
      rationale: typeof o.rationale === "string" ? o.rationale : "",
    };
  } catch {
    return { ...EMPTY, rationale: "invalid JSON in model response" };
  }
}

export interface ConsolidationJudgeResult {
  verdict: ConsolidationVerdict;
  inputTokens: number;
  outputTokens: number;
}

/** Ask the model whether to consolidate a cluster of memories. */
export async function judgeConsolidation(
  adapter: ModelAdapter,
  subjectLabel: string,
  notes: MemoryNote[],
): Promise<ConsolidationJudgeResult> {
  const res = await adapter.complete({
    messages: [
      {
        role: "system",
        content: "You consolidate overlapping memories in a knowledge base. Answer only with the requested JSON.",
      },
      { role: "user", content: buildConsolidationPrompt(subjectLabel, notes) },
    ],
    maxTokens: 512,
  });
  return { verdict: parseConsolidationVerdict(res.text), inputTokens: res.inputTokens, outputTokens: res.outputTokens };
}
