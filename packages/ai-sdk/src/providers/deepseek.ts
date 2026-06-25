import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface DeepSeekConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class DeepSeekProvider implements ProviderFactory {
  readonly name = 'deepseek'
  private readonly config: DeepSeekConfig

  constructor(config: DeepSeekConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://api.deepseek.com/v1',
      },
      model,
    )
  }
}
