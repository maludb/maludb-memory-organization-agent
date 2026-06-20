import { pino, type Logger, type LoggerOptions as PinoLoggerOptions } from "pino";

export interface LoggerOptions {
  name?: string;
  level?: string;
}

/**
 * Shared pino options: level from LOG_LEVEL, pretty output when LOG_PRETTY=1, and
 * token/auth redaction by default (see docs/requirements.md SR-2). Exported so Fastify
 * can build its logger from the same config (`Fastify({ logger: loggerOptions(...) })`).
 */
export function loggerOptions(opts: LoggerOptions = {}): PinoLoggerOptions {
  const level = opts.level ?? process.env.LOG_LEVEL ?? "info";
  const pretty = process.env.LOG_PRETTY === "1";
  return {
    name: opts.name,
    level,
    redact: {
      paths: ["req.headers.authorization", "token", "*.token", "config.token"],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty" } } : {}),
  };
}

/** Create a standalone structured logger (used by the worker and library code). */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino(loggerOptions(opts));
}

export type { Logger };
