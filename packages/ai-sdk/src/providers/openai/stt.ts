import type {
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'

// ─── STT Adapter ─────────────────────────────────────────

export class OpenAISttAdapter implements SpeechToTextAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async transcribe(options: SpeechToTextOptions): Promise<SpeechToTextResult> {
    const client = await this.getClient()

    const file = new File([options.audio], 'audio.mp3', { type: 'audio/mpeg' })

    const params: Record<string, unknown> = {
      model: this.model,
      file,
      response_format: 'verbose_json',
    }
    if (options.language) params['language'] = options.language
    if (options.prompt) params['prompt'] = options.prompt

    const response = await client.audio.transcriptions.create(params)

    return {
      text: response.text,
      language: response.language,
      duration: response.duration,
      model: this.model,
    }
  }
}
