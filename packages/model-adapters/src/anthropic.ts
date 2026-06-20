import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface AnthropicAdapterOptions {
  baseUrl?: string;
  /** Override fetch (for tests). Defaults to the global fetch. */
  fetch?: FetchLike;
}

/**
 * Anthropic Messages API adapter. Provider-neutral interface; the model id is supplied
 * by tenant policy (docs/policies.md §3.10). temperature is intentionally not sent —
 * current Claude models reject it. See the claude-api skill for the request/response shape.
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly provider = "anthropic";
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    opts: AnthropicAdapterOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const system = req.messages.find((m) => m.role === "system")?.content;
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      messages,
    };
    if (system) body.system = system;

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
