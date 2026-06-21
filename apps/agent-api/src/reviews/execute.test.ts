import type { MaludbClient } from "@maludb-agent/maludb-client";
import { describe, expect, it, vi } from "vitest";

import { executeProposal } from "./execute.js";

describe("executeProposal", () => {
  it("closes the losing statement for a contradiction", async () => {
    const client = { closeStatement: vi.fn(async () => undefined) } as unknown as MaludbClient;
    const result = await executeProposal(client, { type: "closeStatement", statementId: 42 });
    expect(client.closeStatement).toHaveBeenCalledWith(42, undefined);
    expect(result).toEqual({ closedStatementId: 42 });
  });

  it("consolidates a cluster and returns the new memory id", async () => {
    const client = {
      consolidate: vi.fn(async () => ({ consolidated_into_memory_id: 7 })),
    } as unknown as MaludbClient;
    const result = await executeProposal(client, {
      type: "consolidate",
      memoryIds: [1, 2],
      kind: "consolidated",
      title: "T",
      summary: "S",
    });
    expect(client.consolidate).toHaveBeenCalledWith({
      memoryIds: [1, 2],
      kind: "consolidated",
      title: "T",
      summary: "S",
      reason: undefined,
    });
    expect(result).toEqual({ consolidated_into_memory_id: 7 });
  });

  it("applies a lifecycle transition", async () => {
    const client = {
      setLifecycle: vi.fn(async () => ({ object_type: "memory", object_id: 3, state: "stale" })),
    } as unknown as MaludbClient;
    const result = await executeProposal(client, {
      type: "lifecycle",
      objectType: "memory",
      objectId: 3,
      state: "stale",
    });
    expect(client.setLifecycle).toHaveBeenCalledWith({
      objectType: "memory",
      objectId: 3,
      state: "stale",
      reason: undefined,
    });
    expect(result).toEqual({ object_type: "memory", object_id: 3, state: "stale" });
  });
});
