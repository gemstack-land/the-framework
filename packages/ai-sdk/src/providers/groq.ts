import { defineOpenAiCompatible } from './openai-compatible.js'

export interface GroqConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class GroqProvider extends defineOpenAiCompatible<GroqConfig>({
  name: 'groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
}) {}
