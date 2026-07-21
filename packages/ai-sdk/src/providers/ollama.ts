import { defineOpenAiCompatible } from './openai-compatible.js'

export interface OllamaConfig {
  baseUrl?: string | undefined
}

export class OllamaProvider extends defineOpenAiCompatible<OllamaConfig>({
  name: 'ollama',
  defaultBaseUrl: 'http://localhost:11434/v1',
  // Ollama ignores the key, but the OpenAI SDK refuses to build without one.
  defaultApiKey: 'ollama',
}) {
  constructor(config: OllamaConfig = {}) {
    super(config)
  }
}
