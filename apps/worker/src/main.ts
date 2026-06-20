import { createPool, migrate } from "@maludb-agent/agent-db";
import { createJobEventSink, createLogger } from "@maludb-agent/observability";

import { loadConfig } from "./config.js";
import { buildConnection } from "./connection.js";
import type { WorkerDeps } from "./context.js";
import { createQueues } from "./queues/index.js";
import { applySchedules } from "./scheduler.js";
import { createWorkers } from "./workers/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger({ name: "agent-worker" });
  const sink = createJobEventSink(log);

  const pool = createPool({ connectionString: config.agentDbUrl });
  const applied = await migrate(pool);
  if (applied.length > 0) log.info({ migrations: applied }, "applied migrations");

  const connection = buildConnection(config);
  const queues = createQueues(connection);
  const deps: WorkerDeps = {
    pool,
    queues,
    sink,
    log,
    env: process.env,
    concurrency: config.concurrency,
  };

  const workers = createWorkers(deps, connection);
  await applySchedules(deps);
  log.info({ queues: Object.keys(queues), workers: workers.length }, "agent-worker started");

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down agent-worker");
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
