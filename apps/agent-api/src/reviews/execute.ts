import type { ReviewProposal } from "@maludb-agent/job-contracts";
import type { CapabilityName, MaludbClient } from "@maludb-agent/maludb-client";

/** The MaluDB capability each proposed action needs, for pre-execution gating (Part C). */
export function requiredCapability(action: ReviewProposal): CapabilityName {
  switch (action.type) {
    case "closeStatement":
      return "statements.close";
    case "consolidate":
      return "memory.consolidate";
    case "lifecycle":
      return "memory.lifecycle";
    default: {
      const exhaustive: never = action;
      throw new Error(`no capability mapping for review action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Execute a review item's proposed action through the MaluDB API (docs/api-contract.md
 * B.2). This is the only place the agent turns an *accepted* review into a real memory
 * mutation — every branch maps to a single, idempotent maludb-client call. The exhaustive
 * switch makes adding a new action type a compile error until it's handled here.
 *
 * Returns the structured result to store as resolution provenance. Throws on API failure
 * (a `Maludb*Error`); the caller leaves the item open so it can be retried.
 */
export async function executeProposal(client: MaludbClient, action: ReviewProposal): Promise<unknown> {
  switch (action.type) {
    case "closeStatement":
      await client.closeStatement(action.statementId, action.validTo);
      return { closedStatementId: action.statementId };

    case "consolidate":
      return client.consolidate({
        memoryIds: action.memoryIds,
        kind: action.kind,
        title: action.title,
        summary: action.summary,
        reason: action.reason,
      });

    case "lifecycle":
      return client.setLifecycle({
        objectType: action.objectType,
        objectId: action.objectId,
        state: action.state,
        reason: action.reason,
      });

    default: {
      const exhaustive: never = action;
      throw new Error(`unsupported review action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
