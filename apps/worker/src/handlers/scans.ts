import { createReviewItem, getDailyCost, recordCost } from "@maludb-agent/agent-db";
import type { JobPayload, JobResult } from "@maludb-agent/job-contracts";

import { adapterForPolicy } from "../adapters.js";
import type { JobContext } from "../context.js";
import { findCandidateConflicts } from "../contradiction/detect.js";
import { judgeConflict } from "../contradiction/judge.js";
import { resolvePolicyForTenant } from "../policy.js";
import { errMessage } from "./util.js";

/**
 * Detect contradictions between active statements about the same subject (ADR-0005,
 * docs/worker-design.md §6). Safe by default: it records review items in the agent's own
 * DB; it only mutates MaluDB (closing the lower-confidence edge) when policy enables
 * auto_resolve. Model spend is metered against the policy's daily cost controls.
 */
export async function contradictionScan(
  ctx: JobContext,
  p: JobPayload<"memory.contradiction.scan">,
): Promise<JobResult<"memory.contradiction.scan">> {
  const policy = await resolvePolicyForTenant(ctx.db, ctx.tenant.id);

  let adapter;
  try {
    adapter = adapterForPolicy(policy, ctx.deps.env);
  } catch (err) {
    ctx.log.warn({ tenantId: ctx.tenant.id, err: errMessage(err) }, "no model adapter; skipping contradiction scan");
    return {
      subjectsExamined: 0,
      contradictionsFound: 0,
      reviewItemsCreated: 0,
      modelCalls: 0,
      tokens: 0,
      capabilityUnavailable: true,
    };
  }

  const callCap = policy.cost_controls.max_model_calls_per_day;
  const tokenCap = policy.cost_controls.max_tokens_per_day;
  const alreadySpent = await getDailyCost(ctx.db, ctx.tenant.id);

  let subjectsExamined = 0;
  let contradictionsFound = 0;
  let reviewItemsCreated = 0;
  let modelCalls = 0;
  let tokens = 0;

  const overBudget = (): boolean =>
    alreadySpent.calls + modelCalls >= callCap || alreadySpent.tokens + tokens >= tokenCap;

  const subjects = await ctx.client.listSubjects({ limit: p.maxSubjectsPerRun });

  for (const subject of subjects) {
    if (overBudget()) {
      ctx.log.warn({ tenantId: ctx.tenant.id }, "daily model budget reached; stopping contradiction scan");
      break;
    }
    subjectsExamined += 1;

    const statements = await ctx.client.listStatements({ subjectId: subject.id, limit: 200 });
    for (const group of findCandidateConflicts(statements)) {
      if (overBudget()) break;

      const { verdict, inputTokens, outputTokens } = await judgeConflict(adapter, group, subject.label);
      modelCalls += 1;
      tokens += inputTokens + outputTokens;
      await recordCost(ctx.db, {
        tenantId: ctx.tenant.id,
        model: policy.models.default.model,
        calls: 1,
        tokens: inputTokens + outputTokens,
      });

      if (!verdict.contradiction || verdict.confidence < p.minConfidenceToFlag) continue;
      contradictionsFound += 1;

      const statementIds = group.statements.map((s) => s.id).sort((a, b) => a - b);
      const dedupKey =
        `${ctx.tenant.id}:contradiction:${group.subjectId}:${group.verbId}:` +
        `${group.predicateId ?? "none"}:${statementIds.join(",")}`;

      if (p.createReviewItems) {
        await createReviewItem(ctx.db, {
          tenantId: ctx.tenant.id,
          kind: "contradiction",
          dedupKey,
          payload: {
            subjectId: group.subjectId,
            subjectLabel: subject.label,
            verbId: group.verbId,
            predicateId: group.predicateId,
            statementIds,
            confidence: verdict.confidence,
            rationale: verdict.rationale,
          },
          provenance: { detectedBy: `${policy.models.default.provider}:${policy.models.default.model}` },
        });
        reviewItemsCreated += 1;
      }

      if (p.autoResolve) {
        // Close the lowest-confidence (the "loser") statement. Never default-on (FR-C4).
        const loser = [...group.statements].sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))[0]!;
        try {
          await ctx.client.closeStatement(loser.id);
        } catch (err) {
          ctx.log.warn({ statementId: loser.id, err: errMessage(err) }, "auto-resolve close failed");
        }
      }
    }
  }

  return { subjectsExamined, contradictionsFound, reviewItemsCreated, modelCalls, tokens, capabilityUnavailable: false };
}

/** Consolidation (phase 2) needs candidate clustering + POST /v1/memory/consolidate. */
export async function consolidationScan(
  ctx: JobContext,
): Promise<JobResult<"memory.consolidation.scan">> {
  ctx.log.warn(
    { tenantId: ctx.tenant.id },
    "consolidation scan not yet implemented; skipping (needs clustering + consolidate workflow)",
  );
  return {
    clustersFound: 0,
    consolidationsProposed: 0,
    reviewItemsCreated: 0,
    capabilityUnavailable: true,
  };
}
