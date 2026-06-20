import { describe, expect, it } from "vitest";

import { AnthropicAdapter } from "./anthropic.js";
import { createAdapter } from "./factory.js";

interface Call {
  url: string;
  init?: RequestInit;
}

function recorder(handler: () => Response): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return handler();
    },
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("AnthropicAdapter", () => {
  it("sends auth headers, extracts system, and maps content + usage", async () => {
    const { fetch, calls } = recorder(() =>
      json(200, {
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "world" },
        ],
        usage: { input_tokens: 11, output_tokens: 7 },
      }),
    );
    const adapter = new AnthropicAdapter("claude-haiku-4-5", "sk-test", { fetch });

    const res = await adapter.complete({
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "hi" },
      ],
      maxTokens: 64,
    });

    expect(res).toEqual({ text: "hello world", inputTokens: 11, outputTokens: 7 });
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.max_tokens).toBe(64);
  });

  it("throws on a non-2xx response", async () => {
    const { fetch } = recorder(() => json(429, { error: { message: "slow down" } }));
    const adapter = new AnthropicAdapter("claude-haiku-4-5", "sk-test", { fetch });
    await expect(adapter.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/429/);
  });
});

describe("createAdapter", () => {
  it("builds an anthropic adapter from env", () => {
    const adapter = createAdapter({ provider: "anthropic", model: "claude-haiku-4-5" }, { ANTHROPIC_API_KEY: "k" });
    expect(adapter.provider).toBe("anthropic");
    expect(adapter.model).toBe("claude-haiku-4-5");
  });

  it("throws when the api key is missing", () => {
    expect(() => createAdapter({ provider: "anthropic", model: "x" }, {})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("throws for unsupported providers", () => {
    expect(() => createAdapter({ provider: "ollama", model: "llama3.1" }, {})).toThrow(/not supported/);
  });
});
