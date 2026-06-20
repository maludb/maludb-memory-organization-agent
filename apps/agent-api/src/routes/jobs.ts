import { getJobRun, listJobRuns } from "@maludb-agent/agent-db";
import { jobTypeSchema, parseJobPayload, type JobType } from "@maludb-agent/job-contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../deps.js";

const triggerInput = z.object({
  tenantId: z.string().min(1),
  jobType: jobTypeSchema,
  params: z.record(z.string(), z.unknown()).optional(),
});

export function registerJobRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/jobs", async (req) => {
    const q = req.query as { tenantId?: string; jobType?: string; limit?: string };
    const jobs = await listJobRuns(deps.pool, {
      tenantId: q.tenantId,
      jobType: q.jobType as JobType | undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { jobs };
  });

  app.get("/v1/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await getJobRun(deps.pool, id);
    if (!run) {
      return reply.code(404).send({ error: { code: "not_found", message: `job run ${id} not found` } });
    }
    return { job: run };
  });

  // Manually trigger a job. The payload is validated against the job-contracts schema
  // before it is enqueued, so the worker always dequeues a valid payload.
  app.post("/v1/jobs", async (req, reply) => {
    const input = triggerInput.parse(req.body);
    const payload = parseJobPayload(input.jobType, {
      tenantId: input.tenantId,
      trigger: "manual",
      ...(input.params ?? {}),
    });
    const job = await deps.queues[input.jobType].add(`${input.tenantId}:${input.jobType}:manual`, payload);
    return reply.code(202).send({ enqueued: { jobType: input.jobType, bullJobId: String(job.id ?? "") } });
  });

  // Re-run a prior job from its recorded inputs.
  app.post("/v1/jobs/:id/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    const run = await getJobRun(deps.pool, id);
    if (!run) {
      return reply.code(404).send({ error: { code: "not_found", message: `job run ${id} not found` } });
    }
    const payload = parseJobPayload(run.jobType, {
      ...(run.inputs as Record<string, unknown>),
      trigger: "manual",
    });
    const job = await deps.queues[run.jobType].add(`${run.tenantId}:${run.jobType}:retry`, payload);
    return reply.code(202).send({ enqueued: { jobType: run.jobType, bullJobId: String(job.id ?? "") } });
  });
}
