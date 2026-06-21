import { describe, expect, it } from "vitest";

import { MaludbClient } from "./client.js";
import {
  CapabilityUnavailableError,
  isCapabilityUnavailable,
  MaludbHttpError,
  MaludbNetworkError,
  MaludbTimeoutError,
} from "./errors.js";
import type { FetchLike } from "./types.js";

interface Call {
  url: string;
  init?: RequestInit;
}

/** Build an injectable fetch driven by a per-attempt handler, recording every call. */
function recorder(handler: (attempt: number, url: string, init?: RequestInit) => Response): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(calls.length, url, init);
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const baseConfig = { baseUrl: "http://maludb.test", token: "malu_test", retryBaseMs: 0, maxRetries: 2 };

function authHeader(init?: RequestInit): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.authorization;
}

describe("MaludbClient request engine", () => {
  it("sends a bearer token but no tenant/namespace header", async () => {
    const { fetch, calls } = recorder(() => json(200, { namespace: "default", config: {} }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    await client.getMemoryConfig();

    expect(authHeader(calls[0]?.init)).toBe("Bearer malu_test");
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-tenant"]).toBeUndefined();
    expect(headers["x-namespace"]).toBeUndefined();
    expect(calls[0]?.url).toBe("http://maludb.test/v1/memory/config?namespace=default");
  });

  it("fetches /openapi.json without auth for capability discovery", async () => {
    const { fetch, calls } = recorder(() => json(200, { paths: { "/v1/statements": { get: {} } } }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const doc = await client.getOpenApi();

    expect(calls[0]?.url).toBe("http://maludb.test/openapi.json");
    expect(authHeader(calls[0]?.init)).toBeUndefined();
    expect(doc.paths?.["/v1/statements"]).toBeDefined();
  });

  it("omits auth on /health", async () => {
    const { fetch, calls } = recorder(() => json(200, { status: "ok" }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const res = await client.health();

    expect(res.status).toBe("ok");
    expect(authHeader(calls[0]?.init)).toBeUndefined();
  });

  it("maps sweep params to snake_case query params", async () => {
    const { fetch, calls } = recorder(() => json(200, { claimed: 0, errors: [] }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    await client.runMemoryReindex({ limit: 32, maxAge: "30 days", sourceType: "note" });
    const url = new URL(calls[0]!.url);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(url.searchParams.get("limit")).toBe("32");
    expect(url.searchParams.get("max_age")).toBe("30 days");
    expect(url.searchParams.get("source_type")).toBe("note");
  });

  it("joins embedding kinds into a comma-separated param", async () => {
    const { fetch, calls } = recorder(() => json(200, { claimed: 0, errors: [] }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    await client.runEmbeddingsDrain({ limit: 64, kinds: ["subject", "verb"] });
    expect(new URL(calls[0]!.url).searchParams.get("kinds")).toBe("subject,verb");
  });

  it("unwraps list envelopes", async () => {
    const { fetch } = recorder(() => json(200, { statements: [{ id: 1 }, { id: 2 }] }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const statements = await client.listStatements({ subjectId: 7 });
    expect(statements).toHaveLength(2);
  });
});

describe("MaludbClient maintenance writes", () => {
  function bodyOf(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(String(init?.body)) as Record<string, unknown>;
  }

  it("closes a statement via PATCH", async () => {
    const { fetch, calls } = recorder(() => json(200, {}));
    const client = new MaludbClient({ ...baseConfig, fetch });

    await client.closeStatement(42);
    expect(calls[0]?.url).toBe("http://maludb.test/v1/statements/42");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(bodyOf(calls[0]?.init)).toEqual({ close: true });
  });

  it("sends consolidate with snake_case memory_ids", async () => {
    const { fetch, calls } = recorder(() => json(201, { consolidated_into_memory_id: 99 }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const res = await client.consolidate({ memoryIds: [1, 2], kind: "consolidated", title: "T", summary: "S" });
    expect(res.consolidated_into_memory_id).toBe(99);
    expect(calls[0]?.url).toBe("http://maludb.test/v1/memory/consolidate");
    expect(bodyOf(calls[0]?.init)).toMatchObject({ memory_ids: [1, 2], kind: "consolidated", title: "T" });
  });

  it("maps lifecycle params to snake_case", async () => {
    const { fetch, calls } = recorder(() => json(200, { object_type: "memory", object_id: 5, state: "stale" }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    await client.setLifecycle({ objectType: "memory", objectId: 5, state: "stale", reason: "old" });
    expect(calls[0]?.url).toBe("http://maludb.test/v1/memory/lifecycle");
    expect(bodyOf(calls[0]?.init)).toEqual({ object_type: "memory", object_id: 5, state: "stale", reason: "old" });
  });

  it("maps score params to snake_case", async () => {
    const { fetch, calls } = recorder(() => json(201, { maut_score_id: 7 }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const res = await client.setScore({
      objectType: "fact",
      objectId: 8,
      category: "contradiction_status",
      subscore: 0.2,
      evaluatorName: "agent",
    });
    expect(res.maut_score_id).toBe(7);
    expect(bodyOf(calls[0]?.init)).toMatchObject({
      object_type: "fact",
      object_id: 8,
      category: "contradiction_status",
      subscore: 0.2,
      evaluator_name: "agent",
    });
  });
});

describe("MaludbClient error handling", () => {
  it("treats 501 as a capability-unavailable error (no retry)", async () => {
    const { fetch, calls } = recorder(() => json(501, { error: { code: "not_implemented", message: "nope" } }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const err = await client.runSkillsReindex({ limit: 32, maxAge: "30 days" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CapabilityUnavailableError);
    expect(isCapabilityUnavailable(err)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("parses the error envelope and does not retry 4xx", async () => {
    const { fetch, calls } = recorder(() => json(400, { error: { code: "bad_request", message: "no" } }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const err = (await client.getMemoryConfig().catch((e: unknown) => e)) as MaludbHttpError;
    expect(err).toBeInstanceOf(MaludbHttpError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("bad_request");
    expect(calls).toHaveLength(1);
  });

  it("retries 5xx then succeeds", async () => {
    const { fetch, calls } = recorder((attempt) =>
      attempt === 1 ? json(503, { error: { code: "unavailable", message: "x" } }) : json(200, { status: "ok" }),
    );
    const client = new MaludbClient({ ...baseConfig, fetch });

    const res = await client.health();
    expect(res.status).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("exhausts retries on persistent 5xx (maxRetries + 1 attempts)", async () => {
    const { fetch, calls } = recorder(() => json(500, { error: { code: "boom", message: "x" } }));
    const client = new MaludbClient({ ...baseConfig, fetch });

    const err = (await client.health().catch((e: unknown) => e)) as MaludbHttpError;
    expect(err).toBeInstanceOf(MaludbHttpError);
    expect(calls).toHaveLength(3);
  });

  it("classifies a network failure after retries", async () => {
    const { fetch, calls } = recorder(() => {
      throw new Error("ECONNRESET");
    });
    const client = new MaludbClient({ ...baseConfig, fetch });

    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaludbNetworkError);
    expect(calls).toHaveLength(3);
  });

  it("classifies an abort as a timeout", async () => {
    const { fetch } = recorder(() => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const client = new MaludbClient({ ...baseConfig, fetch });

    const err = await client.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaludbTimeoutError);
  });
});
