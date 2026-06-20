/**
 * Tracing hooks. Interface-only placeholder; OpenTelemetry-ready (see docs OR-4).
 * A job run opens a span so its API + model calls can be correlated.
 */
export interface Span {
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
}

/** Default no-op tracer. Replace with an OTel-backed implementation later. */
export const noopTracer: Tracer = {
  startSpan: () => ({ end() {} }),
};
