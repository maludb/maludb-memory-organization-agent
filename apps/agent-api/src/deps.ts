import type { Db, TenantRow } from "@maludb-agent/agent-db";
import type { JobType } from "@maludb-agent/job-contracts";
import type { MaludbClient } from "@maludb-agent/maludb-client";
import type { Queue } from "bullmq";

import type { AgentApiConfig } from "./config.js";

/** Dependencies shared by the control-API routes. */
export interface AppDeps {
  config: AgentApiConfig;
  pool: Db;
  queues: Record<JobType, Queue>;
  /**
   * Build a tenant-scoped MaluDB client (token resolved from the tenant's secret ref).
   * Injected so the execute-on-accept path is unit-testable without real tokens.
   */
  makeClient: (tenant: TenantRow) => MaludbClient;
}
