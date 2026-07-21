import type {
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'
import { createOpenAIClient } from './client.js'
import { lazyClient } from '../lazy-client.js'

// ─── STT Adapter ─────────────────────────────────────────

export class OpenAISttAdapter implements SpeechToTextAdapter {
  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  private readonly getClient = lazyClient(() => createOpenAIClient(this.config))

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
