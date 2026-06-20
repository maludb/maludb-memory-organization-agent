import type { FastifyInstance } from "fastify";

/** Liveness route. Readiness (Redis + agent-db checks) is added with those integrations. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "agent-api" }));
}
