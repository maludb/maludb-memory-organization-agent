import { z } from "zod";

/**
 * Proposed actions a review item can carry. The scan workers attach exactly one to each
 * review item's payload; on review **accept** the control API executes that action through
 * maludb-client (docs/api-contract.md B.2). Recording the action explicitly — instead of
 * re-deriving it at accept time — keeps every automated change traceable to the run that
 * proposed it (CLAUDE.md rule 4: provenance + explainability).
 */

/** maludb_core object types that lifecycle/score actions target (api-server PR #9). */
export const reviewObjectType = z.enum(["fact", "memory", "episode_object"]);
export type ReviewObjectType = z.infer<typeof reviewObjectType>;

/** Close (invalidate) the losing statement of a contradiction — PATCH /v1/statements/{id}. */
export const closeStatementAction = z.object({
  type: z.literal("closeStatement"),
  statementId: z.number().int(),
  /** ISO-8601; closes the edge as of this instant instead of "now". */
  validTo: z.string().datetime().optional(),
  reason: z.string().optional(),
});

/** Merge a cluster of memories into one — POST /v1/memory/consolidate. */
export const consolidateAction = z.object({
  type: z.literal("consolidate"),
  memoryIds: z.array(z.number().int()).min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  reason: z.string().optional(),
});

/** Transition an object's lifecycle state (stale|archived|retired) — POST /v1/memory/lifecycle. */
export const lifecycleAction = z.object({
  type: z.literal("lifecycle"),
  objectType: reviewObjectType,
  objectId: z.number().int(),
  state: z.string().min(1),
  reason: z.string().optional(),
});

/** The set of actions the control API knows how to execute, keyed on `type`. */
export const reviewProposalSchema = z.discriminatedUnion("type", [
  closeStatementAction,
  consolidateAction,
  lifecycleAction,
]);
export type ReviewProposal = z.infer<typeof reviewProposalSchema>;

/**
 * The contract the control API relies on when reading a review item's payload: it must
 * carry a `proposedAction`. Display fields (subjectLabel, rationale, confidence, …) pass
 * through untouched for the human reviewer.
 */
export const reviewPayloadSchema = z.object({ proposedAction: reviewProposalSchema }).passthrough();
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;

/** Parse + validate a proposed action. Throws on invalid input. */
export function parseReviewProposal(data: unknown): ReviewProposal {
  return reviewProposalSchema.parse(data);
}

/** Parse + validate a review item's payload (requires a `proposedAction`). */
export function parseReviewPayload(data: unknown): ReviewPayload {
  return reviewPayloadSchema.parse(data);
}
