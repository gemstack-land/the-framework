import { defineOpenAiCompatible } from './openai-compatible.js'

export interface XaiConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class XaiProvider extends defineOpenAiCompatible<XaiConfig>({
  name: 'xai',
  defaultBaseUrl: 'https://api.x.ai/v1',
}) {}
