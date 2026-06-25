import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter } from '../types.js'

/**
 * OpenRouter — single-API access to dozens of models with automatic fallback
 * and cost optimization. The API is OpenAI-compatible, so we reuse the
 * `OpenAIAdapter` with a different base URL.
 *
 * Models follow OpenRouter's naming, e.g.
 *   `openrouter/anthropic/claude-3.5-sonnet`
 *   `openrouter/openai/gpt-4o`
 *   `openrouter/meta-llama/llama-3.3-70b-instruct`
 *
 * @example
 * ```ts
 * // config/ai.ts
 * providers: {
 *   openrouter: {
 *     apiKey: env('OPENROUTER_API_KEY'),
 *     siteUrl: 'https://myapp.com',     // optional — sent as HTTP-Referer
 *     siteName: 'My App',               // optional — sent as X-Title
 *   },
 * }
 * ```
 */
export interface OpenRouterConfig {
  apiKey: string
  baseUrl?: string | undefined
  /**
   * Origin of your app — sent as `HTTP-Referer`. OpenRouter shows this on
   * their leaderboard / per-app analytics. Optional but recommended.
   */
  siteUrl?: string | undefined
  /**
   * Display name of your app — sent as `X-Title`. Optional but recommended.
   */
  siteName?: string | undefined
}

export class OpenRouterProvider implements ProviderFactory {
  readonly name = 'openrouter'
  private readonly config: OpenRouterConfig

  constructor(config: OpenRouterConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    const headers: Record<string, string> = {}
    if (this.config.siteUrl) headers['HTTP-Referer'] = this.config.siteUrl
    if (this.config.siteName) headers['X-Title'] = this.config.siteName

    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://openrouter.ai/api/v1',
        ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
      },
      model,
    )
  }
}
