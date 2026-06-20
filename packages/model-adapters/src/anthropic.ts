import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

/** Anthropic adapter. Scaffold stub — implement in the model-adapters task. */
export class AnthropicAdapter implements ModelAdapter {
  readonly provider = "anthropic";
  constructor(readonly model: string) {}

  complete(_req: ModelRequest): Promise<ModelResponse> {
    throw new Error(`AnthropicAdapter.complete not implemented yet (model=${this.model})`);
  }
}
