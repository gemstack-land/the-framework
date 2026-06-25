import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface OllamaConfig {
  baseUrl?: string | undefined
}

export class OllamaProvider implements ProviderFactory {
  readonly name = 'ollama'
  private readonly config: OllamaConfig

  constructor(config: OllamaConfig = {}) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: 'ollama',
        baseUrl: this.config.baseUrl ?? 'http://localhost:11434/v1',
      },
      model,
    )
  }
}
