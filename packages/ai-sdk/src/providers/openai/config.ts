export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string | undefined
  organization?: string | undefined
  /**
   * Extra headers to send with every request. Used by OpenAI-compatible
   * derivatives — OpenRouter sends `HTTP-Referer` and `X-Title` for analytics.
   */
  defaultHeaders?: Record<string, string> | undefined
}
