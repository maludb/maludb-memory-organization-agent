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
    ...overrides,
  };
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
});
