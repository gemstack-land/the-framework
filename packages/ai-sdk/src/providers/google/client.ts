import type { GoogleConfig } from './config.js'

/**
 * Builds the `@google/genai` SDK client. The import is dynamic so the SDK
 * stays an optional dependency that is only resolved once a Google adapter
 * is used.
 */
export async function createGoogleClient(config: GoogleConfig): Promise<any> {
  const sdk: any = await import(/* @vite-ignore */ '@google/genai')
  const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
  return new GoogleGenAI({ apiKey: config.apiKey })
}
