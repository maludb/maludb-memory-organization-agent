import type { ConnectionOptions } from "bullmq";

import type { WorkerConfig } from "./config.js";

/** BullMQ/Redis connection options derived from config. */
export function buildConnection(config: WorkerConfig): ConnectionOptions {
  return { host: config.redis.host, port: config.redis.port };
}
