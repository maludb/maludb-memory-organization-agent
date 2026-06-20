import type { Db } from "@maludb-agent/agent-db";
import type { JobType } from "@maludb-agent/job-contracts";
import type { Queue } from "bullmq";

import type { AgentApiConfig } from "./config.js";

/** Dependencies shared by the control-API routes. */
export interface AppDeps {
  config: AgentApiConfig;
  pool: Db;
  queues: Record<JobType, Queue>;
}
