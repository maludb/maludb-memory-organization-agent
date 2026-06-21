import { describe, expect, it } from "vitest";

import { parseReviewPayload, parseReviewProposal, reviewProposalSchema } from "./review.js";

describe("review proposals", () => {
  it("accepts each known action type", () => {
    expect(parseReviewProposal({ type: "closeStatement", statementId: 7 }).type).toBe("closeStatement");
    expect(
      parseReviewProposal({ type: "consolidate", memoryIds: [1, 2], kind: "consolidated", title: "T", summary: "S" })
        .type,
    ).toBe("consolidate");
    expect(
      parseReviewProposal({ type: "lifecycle", objectType: "memory", objectId: 3, state: "stale" }).type,
    ).toBe("lifecycle");
  });

  it("rejects an unknown action type", () => {
    expect(reviewProposalSchema.safeParse({ type: "delete", id: 1 }).success).toBe(false);
  });

  it("requires a non-empty memoryIds for consolidate", () => {
    const r = reviewProposalSchema.safeParse({ type: "consolidate", memoryIds: [], kind: "k", title: "t", summary: "" });
    expect(r.success).toBe(false);
  });

  it("requires a proposedAction on the payload but passes display fields through", () => {
    expect(() => parseReviewPayload({ subjectLabel: "Acme" })).toThrow();
    const payload = parseReviewPayload({
      proposedAction: { type: "closeStatement", statementId: 9 },
      subjectLabel: "Acme",
      rationale: "why",
    });
    expect(payload.proposedAction.type).toBe("closeStatement");
    expect((payload as { subjectLabel?: string }).subjectLabel).toBe("Acme");
  });
});
