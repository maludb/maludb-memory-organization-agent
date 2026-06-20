import { describe, expect, it } from "vitest";

import { MaludbClient } from "./client.js";
import type { FetchLike } from "./types.js";

interface Call {
  url: string;
  init?: RequestInit;
}

function recorder(handler: () => Response): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler();
  };
  return { fetch, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const config = { baseUrl: "http://maludb.test", token: "malu_test", retryBaseMs: 0, maxRetries: 0 };

describe("searchMemoryNotes", () => {
  it("maps subjectLike to subject_like and unwraps notes", async () => {
    const { fetch, calls } = recorder(() => json(200, { notes: [{ id: 1 }, { id: 2 }] }));
    const client = new MaludbClient({ ...config, fetch });

    const notes = await client.searchMemoryNotes({ subjectLike: "Alice", limit: 50 });
    expect(notes).toHaveLength(2);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/memory/notes");
    expect(url.searchParams.get("subject_like")).toBe("Alice");
    expect(url.searchParams.get("limit")).toBe("50");
  });
});

describe("consolidate", () => {
  it("POSTs memory_ids and returns the new memory id", async () => {
    const { fetch, calls } = recorder(() => json(201, { consolidated_into_memory_id: 99 }));
    const client = new MaludbClient({ ...config, fetch });

    const res = await client.consolidate({ memoryIds: [1, 2, 3], kind: "consolidated", title: "T", summary: "S" });
    expect(res.consolidated_into_memory_id).toBe(99);
    expect(calls[0]?.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.memory_ids).toEqual([1, 2, 3]);
    expect(body.title).toBe("T");
  });
});

describe("closeStatement", () => {
  it("PATCHes with close:true by default", async () => {
    const { fetch, calls } = recorder(() => json(200, {}));
    const client = new MaludbClient({ ...config, fetch });

    await client.closeStatement(7);
    expect(calls[0]?.url).toBe("http://maludb.test/v1/statements/7");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ close: true });
  });
});
