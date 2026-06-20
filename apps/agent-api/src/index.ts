import { createPool, migrate } from "@maludb-agent/agent-db";

import { loadConfig } from "./config.js";
import { createQueues } from "./queues.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({ connectionString: config.agentDbUrl });
  await migrate(pool);
  const queues = createQueues({ host: config.redis.host, port: config.redis.port });
  const app = buildServer({ config, pool, queues });

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
