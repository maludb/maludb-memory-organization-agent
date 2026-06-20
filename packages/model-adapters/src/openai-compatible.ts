import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

/**
 * OpenAI-compatible adapter (OpenAI, Azure OpenAI, and other /v1/chat/completions
 * compatible endpoints). Scaffold stub — implement in the model-adapters task.
 */
export class OpenAiCompatibleAdapter implements ModelAdapter {
  readonly provider = "openai-compatible";
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
  ) {}

  complete(_req: ModelRequest): Promise<ModelResponse> {
    throw new Error(
      `OpenAiCompatibleAdapter.complete not implemented yet (model=${this.model}, baseUrl=${this.baseUrl})`,
    );
  }
}
