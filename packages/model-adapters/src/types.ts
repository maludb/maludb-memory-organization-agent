/**
 * Provider-neutral model interface. Agent-side model calls (e.g. contradiction
 * detection) go through an adapter so the service is not coupled to one provider
 * (see docs/decisions.md ADR-0005, docs/policies.md §3.10).
 */
export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ModelResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelAdapter {
  readonly provider: string;
  readonly model: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}
