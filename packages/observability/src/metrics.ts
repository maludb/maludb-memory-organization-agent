/**
 * Metrics hooks. Interface-only for now so call sites can be instrumented before a
 * backend is chosen; OpenTelemetry-ready (see docs/requirements.md OR-4).
 */
export interface Metrics {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  timing(name: string, ms: number, tags?: Record<string, string>): void;
}

/** Default no-op metrics. Replace with an OTel-backed implementation later. */
export const noopMetrics: Metrics = {
  increment() {},
  gauge() {},
  timing() {},
};
