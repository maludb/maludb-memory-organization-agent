import { describe, expect, it } from "vitest";

import type { Queryable } from "./pool.js";
import { getDailyCost, recordCost } from "./repositories/cost-records.js";
import { createReviewItem, getReviewItem, resolveReviewItem } from "./repositories/review-items.js";
import { getTenant, upsertTenant } from "./repositories/tenants.js";
import { setWatermark } from "./repositories/watermarks.js";

interface Call {
  text: string;
  values?: unknown[];
}

function fakeDb(rows: unknown[] = []): { db: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows, rowCount: rows.length };
    },
  } as unknown as Queryable;
  return { db, calls };
}

describe("tenants repo", () => {
  it("maps aliased columns to camelCase rows", async () => {
    const { db } = fakeDb([{ id: "acme", apiBaseUrl: "http://x", tokenRef: "ref" }]);
    const tenant = await getTenant(db, "acme");
    expect(tenant?.apiBaseUrl).toBe("http://x");
  });

  it("returns null when not found", async () => {
    const { db } = fakeDb([]);
    expect(await getTenant(db, "nope")).toBeNull();
  });

  it("upserts on id with the expected params", async () => {
    const { db, calls } = fakeDb([{ id: "acme" }]);
    await upsertTenant(db, { id: "acme", apiBaseUrl: "http://x", tokenRef: "ref" });
    expect(calls[0]?.text).toContain("ON CONFLICT (id) DO UPDATE");
    expect(calls[0]?.values?.slice(0, 3)).toEqual(["acme", "http://x", "ref"]);
  });
});

describe("review items repo", () => {
  it("upserts on the dedup key and serializes jsonb params", async () => {
    const { db, calls } = fakeDb([{ id: "r1" }]);
    await createReviewItem(db, {
      tenantId: "acme",
      kind: "contradiction",
      payload: { a: 1 },
      dedupKey: "subj:verb:pred",
    });
    expect(calls[0]?.text).toContain("ON CONFLICT (tenant_id, dedup_key)");
    expect(calls[0]?.values?.[2]).toBe(JSON.stringify({ a: 1 }));
    expect(calls[0]?.values?.[4]).toBe("subj:verb:pred");
  });

  it("fetches a single item by id", async () => {
    const { db, calls } = fakeDb([{ id: "r1", status: "open" }]);
    const row = await getReviewItem(db, "r1");
    expect(row?.id).toBe("r1");
    expect(calls[0]?.text).toContain("WHERE id = $1");
  });

  it("resolves only while open and serializes the result", async () => {
    const { db, calls } = fakeDb([{ id: "r1", status: "accepted" }]);
    const row = await resolveReviewItem(db, "r1", "accepted", {
      resolvedBy: "ops",
      note: "ok",
      result: { consolidated_into_memory_id: 9 },
    });
    expect(row?.status).toBe("accepted");
    expect(calls[0]?.text).toContain("status = 'open'");
    expect(calls[0]?.values).toEqual([
      "r1",
      "accepted",
      "ops",
      "ok",
      JSON.stringify({ consolidated_into_memory_id: 9 }),
    ]);
  });

  it("returns null when no open item matched (already resolved / race)", async () => {
    const { db } = fakeDb([]);
    expect(await resolveReviewItem(db, "r1", "rejected")).toBeNull();
  });
});

describe("cost records repo", () => {
  it("appends a cost event", async () => {
    const { db, calls } = fakeDb([]);
    await recordCost(db, { tenantId: "acme", calls: 3, tokens: 120, model: "claude-haiku-4-5" });
    expect(calls[0]?.text).toContain("INSERT INTO cost_records");
  });

  it("sums daily cost", async () => {
    const { db } = fakeDb([{ calls: 10, tokens: 100 }]);
    expect(await getDailyCost(db, "acme")).toEqual({ calls: 10, tokens: 100 });
  });
});

describe("watermarks repo", () => {
  it("upserts a cursor as jsonb", async () => {
    const { db, calls } = fakeDb([]);
    await setWatermark(db, "acme", "memory.reindex.sweep", { batch: 5 });
    expect(calls[0]?.text).toContain("ON CONFLICT (tenant_id, job_type)");
    expect(calls[0]?.values?.[2]).toBe(JSON.stringify({ batch: 5 }));
  });
});
