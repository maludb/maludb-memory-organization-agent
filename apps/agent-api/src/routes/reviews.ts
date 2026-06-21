import {
  getReviewItem,
  getTenant,
  listReviewItems,
  resolveReviewItem,
  type ReviewKind,
  type ReviewStatus,
} from "@maludb-agent/agent-db";
import { parseReviewProposal, type ReviewProposal } from "@maludb-agent/job-contracts";
import { capabilityState } from "@maludb-agent/maludb-client";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../deps.js";
import { executeProposal, requiredCapability } from "../reviews/execute.js";

const resolveInput = z.object({
  decision: z.enum(["accept", "reject"]),
  /** Operator/actor making the decision; recorded for provenance. */
  actor: z.string().optional(),
  note: z.string().optional(),
});

const notFound = (reply: FastifyReply, message: string): FastifyReply =>
  reply.code(404).send({ error: { code: "not_found", message } });

/**
 * Review queue (docs/HANDOFF.md follow-up 1): list/get the items the scan workers raise,
 * and resolve them. Resolution closes the human-in-the-loop — on **accept** the proposed
 * action is executed against MaluDB before the item is marked accepted; on **reject** the
 * item is simply closed. Nothing destructive happens without an explicit accept (rule 3).
 */
export function registerReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/reviews", async (req) => {
    const q = req.query as { tenantId?: string; status?: string; kind?: string; limit?: string };
    const reviews = await listReviewItems(deps.pool, {
      tenantId: q.tenantId,
      status: q.status as ReviewStatus | undefined,
      kind: q.kind as ReviewKind | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { reviews };
  });

  app.get("/v1/reviews/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const review = await getReviewItem(deps.pool, id);
    if (!review) return notFound(reply, `review item ${id} not found`);
    return { review };
  });

  app.post("/v1/reviews/:id/resolve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = resolveInput.parse(req.body);

    const review = await getReviewItem(deps.pool, id);
    if (!review) return notFound(reply, `review item ${id} not found`);
    if (review.status !== "open") {
      return reply.code(409).send({
        error: { code: "already_resolved", message: `review item ${id} is ${review.status}` },
      });
    }

    if (input.decision === "reject") {
      const updated = await resolveReviewItem(deps.pool, id, "rejected", {
        resolvedBy: input.actor,
        note: input.note,
      });
      if (!updated) return notFound(reply, `review item ${id} not found`);
      return { review: updated };
    }

    // accept → execute the proposed action, then record the result on the item.
    let action: ReviewProposal;
    try {
      action = parseReviewProposal((review.payload as { proposedAction?: unknown } | null)?.proposedAction);
    } catch {
      return reply.code(422).send({
        error: { code: "no_proposed_action", message: `review item ${id} has no executable proposed action` },
      });
    }

    const tenant = await getTenant(deps.pool, review.tenantId);
    if (!tenant) return notFound(reply, `tenant ${review.tenantId} not found`);

    // Don't attempt an action the tenant's MaluDB is known not to expose (capability probe,
    // api-contract Part C). Only block on an explicit `false`; an un-probed tenant (unknown)
    // falls through to the runtime 501 handling below. Leaves the item open to retry later.
    const cap = requiredCapability(action);
    if (capabilityState(tenant.capabilities, cap) === false) {
      return reply.code(422).send({
        error: {
          code: "capability_unavailable",
          message: `tenant ${tenant.id} cannot execute ${action.type}: ${cap} endpoint not available`,
        },
      });
    }

    let result: unknown;
    try {
      result = await executeProposal(deps.makeClient(tenant), action);
    } catch (err) {
      // The action was valid but MaluDB rejected/failed it. Leave the item open so it can
      // be retried; surface the upstream code/message as a 502 (bad upstream).
      const fe = err as { code?: string; message?: string };
      req.log.warn({ reviewId: id, err: fe.message }, "review action execution failed");
      return reply.code(502).send({
        error: { code: fe.code ?? "execution_failed", message: fe.message ?? "review action failed" },
      });
    }

    const updated = await resolveReviewItem(deps.pool, id, "accepted", {
      resolvedBy: input.actor,
      note: input.note,
      result,
    });
    if (!updated) {
      return reply.code(409).send({
        error: { code: "already_resolved", message: `review item ${id} was resolved concurrently` },
      });
    }
    return { review: updated, result };
  });
}
