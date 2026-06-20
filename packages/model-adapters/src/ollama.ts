import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

/** Ollama (local model) adapter. Scaffold stub — implement in the model-adapters task. */
export class OllamaAdapter implements ModelAdapter {
  readonly provider = "ollama";
  constructor(
    readonly model: string,
    private readonly baseUrl = "http://127.0.0.1:11434",
  ) {}

  complete(_req: ModelRequest): Promise<ModelResponse> {
    throw new Error(`OllamaAdapter.complete not implemented yet (model=${this.model}, baseUrl=${this.baseUrl})`);
  }
}
