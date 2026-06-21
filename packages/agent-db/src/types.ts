import type { JobType } from "@maludb-agent/job-contracts";

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "interrupted";
export type ReviewKind = "contradiction" | "consolidation" | "lifecycle";
export type ReviewStatus = "open" | "accepted" | "rejected";

/** A registered tenant. The bearer token is referenced indirectly (ADR-0004). */
export interface TenantRow {
  id: string;
  apiBaseUrl: string;
  /** Secret reference for the bearer token — never the token itself. */
  tokenRef: string;
  namespace: string;
  enabled: boolean;
  policyId: string | null;
  /** Per-tenant capability map from the healthcheck probe (api-contract Part C). */
  capabilities: Record<string, boolean>;
  health: unknown;
  healthStatus: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyRow {
  id: string;
  tenant: string;
  version: number;
  document: unknown;
  createdAt: string;
}

export interface JobRunRow {
  id: string;
  tenantId: string;
  jobType: JobType;
  status: JobRunStatus;
  trigger: string | null;
  policyVersion: number | null;
  inputs: unknown;
  outputs: unknown;
  error: string | null;
  attempts: number;
  bullJobId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ReviewItemRow {
  id: string;
  tenantId: string;
  kind: ReviewKind;
  status: ReviewStatus;
  dedupKey: string | null;
  payload: unknown;
  provenance: unknown;
  createdAt: string;
  resolvedAt: string | null;
  /** Who resolved the item (operator/actor), recorded on accept/reject. */
  resolvedBy: string | null;
  resolutionNote: string | null;
  /** Structured result of executing the accepted action (e.g. consolidated memory id). */
  resolutionResult: unknown;
}

export interface CostRecordRow {
  id: string;
  tenantId: string;
  jobRunId: string | null;
  model: string | null;
  calls: number;
  tokens: number;
  day: string;
  createdAt: string;
}

export interface WatermarkRow {
  tenantId: string;
  jobType: JobType;
  cursor: unknown;
  updatedAt: string;
}
