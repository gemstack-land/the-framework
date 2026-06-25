import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface XaiConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class XaiProvider implements ProviderFactory {
  readonly name = 'xai'
  private readonly config: XaiConfig

  constructor(config: XaiConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://api.x.ai/v1',
      },
      model,
    )
  }
}
