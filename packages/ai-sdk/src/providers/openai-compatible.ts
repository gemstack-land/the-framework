import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

/** The config subset every OpenAI-compatible provider accepts. */
export interface OpenAiCompatibleConfig {
  apiKey?: string | undefined
  baseUrl?: string | undefined
}

export interface OpenAiCompatibleOptions {
  /** Reported as `ProviderFactory.name`. */
  name: string
  /** Used when the caller passes no `baseUrl`. Omit to require one. */
  defaultBaseUrl?: string
  /** For services that ignore the key but whose SDK still demands one. */
  defaultApiKey?: string
}

/**
 * Build a `ProviderFactory` for a service that speaks the OpenAI wire protocol.
 * These differ only in a name and a base URL, so they share `OpenAIAdapter`
 * instead of each re-wrapping it.
 *
 * Providers that add real behaviour (OpenRouter's analytics headers, Mistral's
 * embeddings) stay hand-written.
 */
export function defineOpenAiCompatible<C extends OpenAiCompatibleConfig>(
  options: OpenAiCompatibleOptions,
): new (config: C) => ProviderFactory {
  return class implements ProviderFactory {
    readonly name = options.name
    protected readonly config: C

    constructor(config: C) {
      this.config = config
    }

    create(model: string): ProviderAdapter {
      return new OpenAIAdapter(
        {
          apiKey: this.config.apiKey ?? options.defaultApiKey ?? '',
          baseUrl: this.config.baseUrl ?? options.defaultBaseUrl,
        },
        model,
      )
    }
  }
}
