import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

export interface AzureOpenAIConfig {
  apiKey: string
  /** Azure endpoint, e.g. https://my-resource.openai.azure.com/openai/deployments/my-deployment */
  baseUrl: string
}

export class AzureOpenAIProvider implements ProviderFactory {
  readonly name = 'azure'
  private readonly config: AzureOpenAIConfig

  constructor(config: AzureOpenAIConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
      },
      model,
    )
  }
}
