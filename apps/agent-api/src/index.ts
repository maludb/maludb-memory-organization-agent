import { createPool, migrate, type TenantRow } from "@maludb-agent/agent-db";
import { MaludbClient } from "@maludb-agent/maludb-client";

import { loadConfig } from "./config.js";
import { createQueues } from "./queues.js";
import { resolveToken } from "./secrets.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({ connectionString: config.agentDbUrl });
  await migrate(pool);
  const queues = createQueues({ host: config.redis.host, port: config.redis.port });
  const makeClient = (tenant: TenantRow): MaludbClient =>
    new MaludbClient({
      baseUrl: tenant.apiBaseUrl,
      token: resolveToken(tenant.tokenRef),
      namespace: tenant.namespace,
    });
  const app = buildServer({ config, pool, queues, makeClient });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down agent-api");
    await app.close();
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: config.host, port: config.port });
}

void main();
