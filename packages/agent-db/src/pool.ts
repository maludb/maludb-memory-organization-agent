import pg from "pg";
import type { Pool } from "pg";

/** Anything we can run a query against — a Pool or a checked-out PoolClient. */
export type Queryable = Pick<Pool, "query">;

export interface AgentDbConfig {
  /** Postgres connection string for the agent's OWN operational DB (not a MaluDB DB). */
  connectionString: string;
  /** Max pool size (default 10). */
  max?: number;
}

/** Create a connection pool to the agent operational database. */
export function createPool(config: AgentDbConfig): Pool {
  return new pg.Pool({ connectionString: config.connectionString, max: config.max ?? 10 });
}
