import { getTenant, listTenants, setTenantEnabled, upsertTenant } from "@maludb-agent/agent-db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../deps.js";

const tenantInput = z.object({
  id: z.string().min(1),
  apiBaseUrl: z.string().url(),
  tokenRef: z.string().min(1),
  namespace: z.string().optional(),
  enabled: z.boolean().optional(),
  policyId: z.string().nullable().optional(),
});

export function registerTenantRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/v1/tenants", async () => ({ tenants: await listTenants(deps.pool) }));

  app.post("/v1/tenants", async (req, reply) => {
    const input = tenantInput.parse(req.body);
    const tenant = await upsertTenant(deps.pool, input);
    return reply.code(201).send({ tenant });
  });

  app.get("/v1/tenants/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenant = await getTenant(deps.pool, id);
    if (!tenant) {
      return reply.code(404).send({ error: { code: "not_found", message: `tenant ${id} not found` } });
    }
    return { tenant };
  });

  app.post("/v1/tenants/:id/enable", async (req) => {
    const { id } = req.params as { id: string };
    await setTenantEnabled(deps.pool, id, true);
    return { id, enabled: true };
  });

  app.post("/v1/tenants/:id/disable", async (req) => {
    const { id } = req.params as { id: string };
    await setTenantEnabled(deps.pool, id, false);
    return { id, enabled: false };
  });
}
