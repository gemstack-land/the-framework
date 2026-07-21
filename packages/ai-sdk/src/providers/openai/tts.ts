import type {
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'
import { createOpenAIClient } from './client.js'
import { lazyClient } from '../lazy-client.js'

// ─── TTS Adapter ─────────────────────────────────────────

export class OpenAITtsAdapter implements TextToSpeechAdapter {
  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  private readonly getClient = lazyClient(() => createOpenAIClient(this.config))

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
