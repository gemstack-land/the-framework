import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface GroqConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class GroqProvider implements ProviderFactory {
  readonly name = 'groq'
  private readonly config: GroqConfig

  constructor(config: GroqConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://api.groq.com/openai/v1',
      },
      model,
    )
  }
}
