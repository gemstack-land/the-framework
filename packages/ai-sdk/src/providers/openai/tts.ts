import type {
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'

// ─── TTS Adapter ─────────────────────────────────────────

export class OpenAITtsAdapter implements TextToSpeechAdapter {
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

  async generate(options: TextToSpeechOptions): Promise<TextToSpeechResult> {
    const client = await this.getClient()
    const format = options.format ?? 'mp3'

    const params: Record<string, unknown> = {
      model: this.model,
      input: options.text,
      voice: options.voice ?? 'alloy',
    }
    if (options.speed !== undefined) params['speed'] = options.speed
    if (options.format) params['response_format'] = options.format

    const response = await client.audio.speech.create(params)
    const arrayBuffer = await response.arrayBuffer()

    return {
      audio: Buffer.from(arrayBuffer),
      format,
      model: this.model,
    }
  }
}
