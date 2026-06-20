import { z } from "zod";

const envSchema = z.object({
  AGENT_API_HOST: z.string().default("0.0.0.0"),
  AGENT_API_PORT: z.coerce.number().int().positive().default(3000),
  AGENT_DB_URL: z.string().min(1, "AGENT_DB_URL is required"),
  AGENT_ADMIN_TOKEN: z.string().min(1, "AGENT_ADMIN_TOKEN is required"),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
});

export interface AgentApiConfig {
  host: string;
  port: number;
  agentDbUrl: string;
  /** Operator auth for the control API (docs/requirements.md SR-4). */
  adminToken: string;
  redis: { host: string; port: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentApiConfig {
  const parsed = envSchema.parse(env);
  return {
    host: parsed.AGENT_API_HOST,
    port: parsed.AGENT_API_PORT,
    agentDbUrl: parsed.AGENT_DB_URL,
    adminToken: parsed.AGENT_ADMIN_TOKEN,
    redis: { host: parsed.REDIS_HOST, port: parsed.REDIS_PORT },
  };
}
