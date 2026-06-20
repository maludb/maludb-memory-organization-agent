import { buildServer } from "./server.js";

const port = Number(process.env.AGENT_API_PORT ?? 3000);
const host = process.env.AGENT_API_HOST ?? "0.0.0.0";

const app = buildServer();

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
