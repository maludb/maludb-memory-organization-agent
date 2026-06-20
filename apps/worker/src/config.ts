import { z } from "zod";

const envSchema = z.object({
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  AGENT_DB_URL: z.string().min(1, "AGENT_DB_URL is required"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
});

export interface WorkerConfig {
  redis: { host: string; port: number };
  agentDbUrl: string;
  concurrency: number;
}

/** Validate process env into a typed config; throws (and the process should exit) if invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.parse(env);
  return {
    redis: { host: parsed.REDIS_HOST, port: parsed.REDIS_PORT },
    agentDbUrl: parsed.AGENT_DB_URL,
    concurrency: parsed.WORKER_CONCURRENCY,
  };
}
