import { getTenant, type Db, type Queryable, type TenantRow } from "@maludb-agent/agent-db";
import type { JobType } from "@maludb-agent/job-contracts";
import { MaludbClient } from "@maludb-agent/maludb-client";
import type { JobEventSink, Logger } from "@maludb-agent/observability";
import type { Queue } from "bullmq";

import { resolveToken } from "./secrets.js";

/** Long-lived dependencies shared by all job handlers. */
export interface WorkerDeps {
  pool: Db;
  queues: Record<JobType, Queue>;
  sink: JobEventSink;
  log: Logger;
  env: NodeJS.ProcessEnv;
  concurrency: number;
}

/** Per-job context: a tenant-scoped MaluDB client plus DB/observability handles. */
export interface JobContext {
  deps: WorkerDeps;
  db: Queryable;
  client: MaludbClient;
  tenant: TenantRow;
  sink: JobEventSink;
  log: Logger;
  jobId: string;
}

/** Build a job context: load the tenant, resolve its token, construct a scoped client. */
export async function buildContext(
  deps: WorkerDeps,
  tenantId: string,
  jobId: string,
): Promise<JobContext> {
  const tenant = await getTenant(deps.pool, tenantId);
  if (!tenant) throw new Error(`unknown tenant: ${tenantId}`);
  const token = resolveToken(tenant.tokenRef, deps.env);
  const client = new MaludbClient({
    baseUrl: tenant.apiBaseUrl,
    token,
    namespace: tenant.namespace,
  });
  return { deps, db: deps.pool, client, tenant, sink: deps.sink, log: deps.log, jobId };
}
