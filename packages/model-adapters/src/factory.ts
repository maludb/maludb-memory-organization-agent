import { AnthropicAdapter } from "./anthropic.js";
import type { ModelAdapter } from "./types.js";

export interface ModelRef {
  provider: string;
  model: string;
}

/**
 * Build a model adapter for a provider/model reference (e.g. a policy's models.default).
 * API keys are read from the environment, never stored in policy or the operational DB.
 * Only anthropic is wired today; openai-compatible/ollama remain interface stubs.
 */
export function createAdapter(ref: ModelRef, env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  switch (ref.provider) {
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicAdapter(ref.model, apiKey);
    }
    default:
      throw new Error(`model provider not supported yet: ${ref.provider}`);
  }
}
