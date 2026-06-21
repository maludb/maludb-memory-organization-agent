import { type MaludbClient } from "@maludb-agent/maludb-client";
import { describe, expect, it } from "vitest";

import type { JobContext } from "../context.js";
import { tenantHealthcheck } from "./healthcheck.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeCtx(client: Partial<MaludbClient>): { ctx: JobContext; saved: any[] } {
  const saved: any[] = [];
  const ctx = {
    deps: {} as any,
    db: {
      query: async (_t: string, values?: unknown[]) => {
        saved.push(values);
        return { rows: [], rowCount: 0 };
      },
    } as any,
    client: client as MaludbClient,
    tenant: { id: "acme" } as any,
    sink: { emit() {} },
    log: { info() {}, warn() {}, error() {}, debug() {} } as any,
    jobId: "job1",
  };
  return { ctx, saved };
}

const okClient = {
  health: async () => ({ status: "ok" }),
  getMemoryConfig: async () => ({ namespace: "default", config: {} }),
};

describe("tenantHealthcheck", () => {
  it("derives and persists the capability map from /openapi.json", async () => {
    const { ctx, saved } = fakeCtx({
      ...okClient,
      getOpenApi: async () => ({
        paths: { "/v1/memory/consolidate": { post: {} } },
      }),
    });

    const res = await tenantHealthcheck(ctx);

    expect(res.healthy).toBe(true);
    expect(res.capabilities["memory.consolidate"]).toBe(true);
    expect(res.capabilities["memory.lifecycle"]).toBe(false);
    // persisted as the second UPDATE param (capabilities jsonb)
    expect(JSON.parse(saved[0]?.[1])["memory.consolidate"]).toBe(true);
  });

  it("degrades gracefully (empty map + warning) when the probe fails", async () => {
    const { ctx } = fakeCtx({
      ...okClient,
      getOpenApi: async () => {
        throw new Error("network down");
      },
    });

    const res = await tenantHealthcheck(ctx);

    expect(res.capabilities).toEqual({});
    expect(res.warnings.some((w) => /capability probe failed/.test(w))).toBe(true);
  });
});
