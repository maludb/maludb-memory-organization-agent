import type { FastifyInstance } from "fastify";

/**
 * Operator auth for the control API (SR-4): a static admin bearer token gates every
 * /v1/* route. /health stays open. Designed to be swapped for real auth later.
 */
export function registerOperatorAuth(app: FastifyInstance, adminToken: string): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    if (req.headers.authorization !== `Bearer ${adminToken}`) {
      return reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "operator authentication required" } });
    }
  });
}
