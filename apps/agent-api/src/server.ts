import { loggerOptions } from "@maludb-agent/observability";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { AppDeps } from "./deps.js";
import { registerOperatorAuth } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerReviewRoutes } from "./routes/reviews.js";
import { registerTenantRoutes } from "./routes/tenants.js";

/**
 * Build the Fastify control-plane app. Operator auth gates /v1/*; validation errors
 * become 400s with the same {error:{code,message}} envelope MaluDB itself uses.
 */
export function buildServer(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: loggerOptions({ name: "agent-api" }) });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "validation_error", message: err.message } });
    }
    const fe = err as { statusCode?: number; code?: string; message?: string };
    const status = fe.statusCode && fe.statusCode >= 400 ? fe.statusCode : 500;
    if (status >= 500) app.log.error({ err }, "request error");
    return reply
      .code(status)
      .send({ error: { code: fe.code ?? "internal_error", message: fe.message ?? "internal error" } });
  });

  registerOperatorAuth(app, deps.config.adminToken);
  void app.register(healthRoutes);
  registerTenantRoutes(app, deps);
  registerPolicyRoutes(app, deps);
  registerJobRoutes(app, deps);
  registerReviewRoutes(app, deps);

  return app;
}
