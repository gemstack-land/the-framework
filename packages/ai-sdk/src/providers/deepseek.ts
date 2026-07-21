import { defineOpenAiCompatible } from './openai-compatible.js'

export interface DeepSeekConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class DeepSeekProvider extends defineOpenAiCompatible<DeepSeekConfig>({
  name: 'deepseek',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
}) {}
