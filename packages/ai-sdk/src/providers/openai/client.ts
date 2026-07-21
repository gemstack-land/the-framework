import type { OpenAIConfig } from './config.js'

/**
 * Builds the `openai` SDK client. The import is dynamic so the SDK stays an
 * optional dependency that is only resolved once an OpenAI adapter is used.
 */
export async function createOpenAIClient(config: OpenAIConfig): Promise<any> {
  const sdk = await import(/* @vite-ignore */ 'openai')
  const OpenAI = sdk.default ?? sdk.OpenAI
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
  })
}
