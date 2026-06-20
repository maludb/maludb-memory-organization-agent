import { getPolicy, insertPolicy, listPolicies } from "@maludb-agent/agent-db";
import { parsePolicy, parsePolicyYaml, type Policy } from "@maludb-agent/policy-engine";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../deps.js";

export function registerPolicyRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/policies", async (req) => {
    const { tenant } = req.query as { tenant?: string };
    return { policies: await listPolicies(deps.pool, tenant) };
  });

  // Accept either a JSON policy body or { "yaml": "<document>" }. Validation throws a
  // ZodError -> 400 via the error handler. Stored versioned by (tenant, version).
  app.post("/v1/policies", async (req, reply) => {
    const body = req.body as { yaml?: unknown } | undefined;
    const policy: Policy =
      body && typeof body.yaml === "string" ? parsePolicyYaml(body.yaml) : parsePolicy(req.body);
    const id = `${policy.tenant}:${policy.memory_policy_version}`;
    const row = await insertPolicy(deps.pool, {
      id,
      tenant: policy.tenant,
      version: policy.memory_policy_version,
      document: policy,
    });
    return reply.code(201).send({ policy: row });
  });

  app.get("/v1/policies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await getPolicy(deps.pool, id);
    if (!row) {
      return reply.code(404).send({ error: { code: "not_found", message: `policy ${id} not found` } });
    }
    return { policy: row };
  });
}
