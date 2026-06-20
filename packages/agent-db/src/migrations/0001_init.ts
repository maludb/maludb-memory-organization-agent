import type { Migration } from "./index.js";

/**
 * Initial operational schema (docs/architecture.md §7). SQL is embedded as a string so
 * it compiles into dist with no asset-copy step; it is still plain, reviewable SQL. This
 * DB holds the agent's OWN state only — never a copy of MaluDB memory data.
 */
export const migration0001: Migration = {
  id: "0001_init",
  sql: /* sql */ `
CREATE TABLE IF NOT EXISTS policies (
  id          text PRIMARY KEY,
  tenant      text NOT NULL,
  version     integer NOT NULL,
  document    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant, version)
);

CREATE TABLE IF NOT EXISTS tenants (
  id              text PRIMARY KEY,
  api_base_url    text NOT NULL,
  token_ref       text NOT NULL,
  namespace       text NOT NULL DEFAULT 'default',
  enabled         boolean NOT NULL DEFAULT true,
  policy_id       text REFERENCES policies(id) ON DELETE SET NULL,
  capabilities    jsonb NOT NULL DEFAULT '{}'::jsonb,
  health          jsonb,
  health_status   text,
  last_health_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type        text NOT NULL,
  status          text NOT NULL,
  trigger         text,
  policy_version  integer,
  inputs          jsonb,
  outputs         jsonb,
  error           text,
  attempts        integer NOT NULL DEFAULT 0,
  bull_job_id     text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_runs_tenant_type_created_idx
  ON job_runs (tenant_id, job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_status_idx ON job_runs (status);

CREATE TABLE IF NOT EXISTS review_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  dedup_key    text,
  payload      jsonb NOT NULL,
  provenance   jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
-- Idempotency: at most one review item per (tenant, dedup_key) when a key is provided.
CREATE UNIQUE INDEX IF NOT EXISTS review_items_dedup_idx
  ON review_items (tenant_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS review_items_tenant_status_idx ON review_items (tenant_id, status);

CREATE TABLE IF NOT EXISTS cost_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_run_id   uuid REFERENCES job_runs(id) ON DELETE SET NULL,
  model        text,
  calls        integer NOT NULL DEFAULT 0,
  tokens       integer NOT NULL DEFAULT 0,
  day          date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_records_tenant_day_idx ON cost_records (tenant_id, day);

CREATE TABLE IF NOT EXISTS watermarks (
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type    text NOT NULL,
  cursor      jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_type)
);
`,
};
