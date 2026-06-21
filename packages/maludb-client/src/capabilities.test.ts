import { describe, expect, it } from "vitest";

import { capabilityState, deriveCapabilities } from "./capabilities.js";

const openapi = {
  paths: {
    "/v1/memory/reindex/run": { post: {} },
    "/v1/statements": { get: {}, post: {} },
    "/v1/statements/{statement_id}": { get: {}, patch: {} },
    "/v1/memory/consolidate": { post: {} },
    // lifecycle/score/etc. intentionally absent (older deployment without PR #9)
  },
};

describe("deriveCapabilities", () => {
  it("marks present endpoints true and absent ones false", () => {
    const caps = deriveCapabilities(openapi);
    expect(caps["memory.reindex"]).toBe(true);
    expect(caps["memory.consolidate"]).toBe(true);
    expect(caps["memory.lifecycle"]).toBe(false);
    expect(caps["memory.score"]).toBe(false);
  });

  it("matches templated paths regardless of the parameter name", () => {
    // registry uses {id}; the server exposes {statement_id}
    expect(deriveCapabilities(openapi)["statements.close"]).toBe(true);
  });

  it("requires the right method, not just the path", () => {
    const caps = deriveCapabilities({ paths: { "/v1/memory/consolidate": { get: {} } } });
    expect(caps["memory.consolidate"]).toBe(false); // only GET present, capability wants POST
  });

  it("returns a complete map (all keys) even for an empty/missing doc", () => {
    const caps = deriveCapabilities(undefined);
    expect(Object.values(caps).every((v) => v === false)).toBe(true);
    expect(caps["memory.reindex"]).toBe(false);
  });
});

describe("capabilityState", () => {
  it("is undefined (unknown) when the tenant has never been probed", () => {
    expect(capabilityState({}, "memory.consolidate")).toBeUndefined();
    expect(capabilityState(null, "memory.consolidate")).toBeUndefined();
  });

  it("reflects an explicit boolean once probed", () => {
    const map = deriveCapabilities(openapi);
    expect(capabilityState(map, "memory.consolidate")).toBe(true);
    expect(capabilityState(map, "memory.lifecycle")).toBe(false);
  });
});
