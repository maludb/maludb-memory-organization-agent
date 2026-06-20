import type { JobEvent } from "@maludb-agent/job-contracts";
import { describe, expect, it } from "vitest";

import { createJobEventSink } from "./job-events.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";

function fakeLogger(): { logger: Logger; levels: string[] } {
  const levels: string[] = [];
  const record = (level: string) => () => levels.push(level);
  const logger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
  } as unknown as Logger;
  return { logger, levels };
}

function fakeMetrics(): { metrics: Metrics; counts: number } {
  let counts = 0;
  const metrics: Metrics = {
    increment() {
      counts += 1;
    },
    gauge() {},
    timing() {},
  };
  return {
    metrics,
    get counts() {
      return counts;
    },
  };
}

const base = { tenantId: "acme", jobType: "memory.reindex.sweep" as const };

describe("createJobEventSink", () => {
  it("logs each event at the appropriate level and counts a metric", () => {
    const { logger, levels } = fakeLogger();
    const m = fakeMetrics();
    const sink = createJobEventSink(logger, m.metrics);

    const events: JobEvent[] = [
      { event: "job.started", ...base, at: "2026-06-20T00:00:00.000Z" },
      { event: "job.succeeded", ...base, at: "2026-06-20T00:00:00.000Z" },
      { event: "job.failed", ...base, at: "2026-06-20T00:00:00.000Z", error: "x", attempt: 1, willRetry: true },
      { event: "job.skipped", ...base, at: "2026-06-20T00:00:00.000Z", reason: "capability_unavailable" },
      { event: "batch.completed", ...base, at: "2026-06-20T00:00:00.000Z", batchIndex: 0, claimed: 5 },
    ];
    for (const e of events) sink.emit(e);

    expect(levels).toEqual(["info", "info", "error", "warn", "debug"]);
    expect(m.counts).toBe(events.length);
  });

  it("works without a metrics implementation (no-op default)", () => {
    const { logger, levels } = fakeLogger();
    const sink = createJobEventSink(logger);
    sink.emit({ event: "job.started", ...base, at: "2026-06-20T00:00:00.000Z" });
    expect(levels).toEqual(["info"]);
  });
});
