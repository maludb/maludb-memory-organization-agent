import { loggerOptions } from "@maludb-agent/observability";
import Fastify, { type FastifyInstance } from "fastify";

import { healthRoutes } from "./routes/health.js";

/**
 * Build the Fastify control-plane app. Routes are registered as plugins so the
 * V1 surface (tenants, policies, jobs) can be added incrementally.
 * See docs/architecture.md §3 and the route list in the README.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: loggerOptions({ name: "agent-api" }) });

  void app.register(healthRoutes);
  // TODO(agent-api): register /v1/tenants, /v1/policies, /v1/jobs route plugins.

  return app;
}
