import { describe, expect, it } from "vitest";

import { parseJobEvent } from "./events.js";

const at = "2026-06-20T00:00:00.000Z";

describe("jobEventSchema", () => {
  it("parses a job.started event", () => {
    const event = parseJobEvent({
      event: "job.started",
      tenantId: "acme",
      jobType: "memory.reindex.sweep",
      at,
    });
    expect(event.event).toBe("job.started");
  });

  it("requires error/attempt/willRetry on job.failed", () => {
    expect(() =>
      parseJobEvent({ event: "job.failed", tenantId: "acme", jobType: "embeddings.drain", at }),
    ).toThrow();

    const failed = parseJobEvent({
      event: "job.failed",
      tenantId: "acme",
      jobType: "embeddings.drain",
      at,
      error: "timeout",
      attempt: 1,
      willRetry: true,
    });
    expect(failed).toMatchObject({ error: "timeout", attempt: 1, willRetry: true });
  });

  it("rejects an unknown event name", () => {
    expect(() =>
      parseJobEvent({ event: "job.exploded", tenantId: "acme", jobType: "policy.evaluate", at }),
    ).toThrow();
  });

  it("rejects a non-ISO timestamp", () => {
    expect(() =>
      parseJobEvent({
        event: "job.started",
        tenantId: "acme",
        jobType: "policy.evaluate",
        at: "yesterday",
      }),
    ).toThrow();
  });
});
