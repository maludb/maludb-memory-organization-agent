import { createLogger } from "@maludb-agent/observability";
import type { ConnectionOptions } from "bullmq";

import { createQueues } from "./queues/index.js";
import { createWorkers } from "./workers/index.js";

const log = createLogger({ name: "agent-worker" });

const connection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const queues = createQueues(connection);
const workers = createWorkers(connection, log);

log.info({ queues: Object.keys(queues), workers: workers.length }, "agent-worker started");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down agent-worker");
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
