import { JOB_TYPES } from "@maludb-agent/job-contracts";
import { describe, expect, it } from "vitest";

import type { AppDeps } from "./deps.js";
import { buildServer } from "./server.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as any;
  const queues = Object.fromEntries(
    JOB_TYPES.map((t) => [t, { add: async () => ({ id: "1" }) }]),
  ) as any;
  return {
    config: {
      host: "0.0.0.0",
      port: 3000,
      agentDbUrl: "x",
      adminToken: "test",
      redis: { host: "127.0.0.1", port: 6379 },
    },
    pool,
    queues,
    makeClient: () => ({}) as any,
    ...overrides,
  };
}

/** A pool that answers each SQL shape the review routes hit, for the resolve flow. */
function reviewPool(item: Record<string, unknown>, tenant: Record<string, unknown> | null) {
  return {
    query: async (text: string) => {
      if (/UPDATE review_items/.test(text)) {
        return { rows: [{ ...item, status: "accepted" }], rowCount: 1 };
      }
      if (/FROM tenants/.test(text)) {
        return { rows: tenant ? [tenant] : [], rowCount: tenant ? 1 : 0 };
      }
      if (/FROM review_items/.test(text)) {
        return { rows: [item], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as any;
}

const auth = { authorization: "Bearer test", "content-type": "application/json" };

describe("agent-api", () => {
  it("serves /health without auth", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects /v1 routes without the operator token", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({ method: "GET", url: "/v1/tenants" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("lists tenants with auth", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({ method: "GET", url: "/v1/tenants", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenants: [] });
    await app.close();
  });

  it("returns 400 for an invalid tenant body", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: auth,
      payload: { id: "acme" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("creates a tenant (201)", async () => {
    const pool = { query: async () => ({ rows: [{ id: "acme" }], rowCount: 1 }) } as any;
    const app = buildServer(fakeDeps({ pool }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/tenants",
      headers: auth,
      payload: { id: "acme", apiBaseUrl: "http://acme.test", tokenRef: "MALUDB_TOKEN__ACME" },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it("rejects an unknown job type on trigger (400)", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: auth,
      payload: { tenantId: "acme", jobType: "nope" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("enqueues a manual job (202)", async () => {
    let added = false;
    const queues = Object.fromEntries(
      JOB_TYPES.map((t) => [
        t,
        {
          add: async () => {
            added = true;
            return { id: "42" };
          },
        },
      ]),
    ) as any;
    const app = buildServer(fakeDeps({ queues }));
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: auth,
      payload: { tenantId: "acme", jobType: "memory.reindex.sweep" },
    });
    expect(res.statusCode).toBe(202);
    expect(added).toBe(true);
    expect(res.json().enqueued.bullJobId).toBe("42");
    await app.close();
  });

  it("lists reviews with auth", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({ method: "GET", url: "/v1/reviews", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reviews: [] });
    await app.close();
  });

  it("404s an unknown review item", async () => {
    const app = buildServer(fakeDeps());
    const res = await app.inject({ method: "GET", url: "/v1/reviews/nope", headers: auth });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("rejects a review without executing any action", async () => {
    let executed = false;
    const item = { id: "r1", tenantId: "acme", status: "open", payload: {} };
    const deps = fakeDeps({
      pool: reviewPool(item, { id: "acme", apiBaseUrl: "http://x", namespace: "default", tokenRef: "R" }),
      makeClient: () => ({ consolidate: async () => ((executed = true), {}) }) as any,
    });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reviews/r1/resolve",
      headers: auth,
      payload: { decision: "reject", actor: "ops" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().review.status).toBe("accepted"); // reviewPool stamps the UPDATE result
    expect(executed).toBe(false);
    await app.close();
  });

  it("accepts a consolidation review and executes it", async () => {
    let consolidatedWith: unknown;
    const item = {
      id: "r1",
      tenantId: "acme",
      status: "open",
      kind: "consolidation",
      payload: {
        proposedAction: { type: "consolidate", memoryIds: [1, 2], kind: "consolidated", title: "T", summary: "S" },
      },
    };
    const deps = fakeDeps({
      pool: reviewPool(item, { id: "acme", apiBaseUrl: "http://x", namespace: "default", tokenRef: "R" }),
      makeClient: () =>
        ({
          consolidate: async (p: unknown) => {
            consolidatedWith = p;
            return { consolidated_into_memory_id: 99 };
          },
        }) as any,
    });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reviews/r1/resolve",
      headers: auth,
      payload: { decision: "accept", actor: "ops" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({ consolidated_into_memory_id: 99 });
    expect(consolidatedWith).toMatchObject({ memoryIds: [1, 2], title: "T" });
    await app.close();
  });

  it("422s an accept when the payload has no proposed action", async () => {
    const item = { id: "r1", tenantId: "acme", status: "open", payload: { subjectLabel: "Acme" } };
    const deps = fakeDeps({ pool: reviewPool(item, { id: "acme" }) });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reviews/r1/resolve",
      headers: auth,
      payload: { decision: "accept" },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it("502s when executing the accepted action fails upstream", async () => {
    const item = {
      id: "r1",
      tenantId: "acme",
      status: "open",
      payload: { proposedAction: { type: "closeStatement", statementId: 5 } },
    };
    const deps = fakeDeps({
      pool: reviewPool(item, { id: "acme", apiBaseUrl: "http://x", namespace: "default", tokenRef: "R" }),
      makeClient: () =>
        ({
          closeStatement: async () => {
            throw Object.assign(new Error("boom"), { code: "conflict" });
          },
        }) as any,
    });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reviews/r1/resolve",
      headers: auth,
      payload: { decision: "accept" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("conflict");
    await app.close();
  });

  it("409s when the item is already resolved", async () => {
    const item = { id: "r1", tenantId: "acme", status: "accepted", payload: {} };
    const deps = fakeDeps({ pool: reviewPool(item, { id: "acme" }) });
    const app = buildServer(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/reviews/r1/resolve",
      headers: auth,
      payload: { decision: "reject" },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
