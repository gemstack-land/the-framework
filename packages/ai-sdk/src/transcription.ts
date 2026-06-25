import { AiRegistry, tryWithFailover } from './registry.js'
import type { SpeechToTextResult } from './types.js'

/**
 * Fluent builder for speech-to-text transcription.
 *
 * @example
 * const result = await Transcription.fromBytes(bytes).language('en').generate()
 *
 * For Node-only path-based loading, see `@gemstack/ai-sdk/node`:
 *   const t = await transcribeFromPath('./audio.mp3')
 *
 * @example  Failover across providers
 * const result = await Transcription.fromBytes(bytes)
 *   .model('openai/whisper-1')
 *   .failover('google/gemini-2.0-flash-exp')
 *   .generate()
 */
export class Transcription {
  private _model?: string
  private _language?: string
  private _prompt?: string
  private _failover: string[] = []

  private constructor(private readonly _audio: Uint8Array) {}

  /** Create a Transcription from raw audio bytes */
  static fromBytes(bytes: Uint8Array): Transcription {
    return new Transcription(bytes)
  }

  /** @deprecated Use fromBytes(). Buffer extends Uint8Array, so this is a thin alias. */
  static fromBuffer(buffer: Uint8Array): Transcription {
    return new Transcription(buffer)
  }

  /** Set the STT model (e.g. 'openai/whisper-1') */
  model(m: string): this {
    this._model = m
    return this
  }

  /**
   * Provider/model strings to try if the primary fails.
   * Tried in order; the first to succeed wins.
   */
  failover(...models: string[]): this {
    this._failover = models
    return this
  }

  /** Set the language hint (ISO-639-1, e.g. 'en', 'es', 'fr') */
  language(l: string): this {
    this._language = l
    return this
  }

  /** Set an optional prompt to guide transcription style */
  prompt(p: string): this {
    this._prompt = p
    return this
  }

  /** Run the transcription */
  async generate(): Promise<SpeechToTextResult> {
    const primary = this._model ?? AiRegistry.getDefault()
    return tryWithFailover(primary, this._failover, async (modelString) => {
      const [providerName, modelId] = AiRegistry.parseModelString(modelString)
      const factory = AiRegistry.getFactory(providerName)

      if (!factory.createStt) {
        throw new Error(
          `[Rudder AI] Provider "${providerName}" does not support speech-to-text. ` +
          `Use a provider that implements createStt() (e.g. openai).`,
        )
      }

      const adapter = factory.createStt(modelId)
      return adapter.transcribe({
        audio: this._audio,
        model: modelId,
        language: this._language,
        prompt: this._prompt,
      })
    })
  }
}
