import { AiRegistry, tryWithFailover } from './registry.js'
import type { TextToSpeechResult } from './types.js'

type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav'

/**
 * Fluent builder for text-to-speech generation.
 *
 * @example
 * const result = await AudioGenerator.of('Hello world').voice('alloy').generate()
 * await AudioGenerator.of('Hello').format('wav').store('audio/greeting.wav')
 *
 * @example  Failover across providers
 * const result = await AudioGenerator.of('Hello')
 *   .model('openai/tts-1-hd')
 *   .failover('elevenlabs/eleven_multilingual_v2')
 *   .generate()
 */
export class AudioGenerator {
  private _model?: string
  private _voice?: string
  private _speed?: number
  private _format?: AudioFormat
  private _failover: string[] = []

  private constructor(private readonly _text: string) {}

  /** Create an AudioGenerator for the given text */
  static of(text: string): AudioGenerator {
    return new AudioGenerator(text)
  }

  /** Set the TTS model (e.g. 'openai/tts-1-hd') */
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

  /** Set the voice (e.g. 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer') */
  voice(v: string): this {
    this._voice = v
    return this
  }

  /** Set playback speed (0.25 to 4.0) */
  speed(s: number): this {
    this._speed = s
    return this
  }

  /** Set output audio format */
  format(f: AudioFormat): this {
    this._format = f
    return this
  }

  /** Generate the audio */
  async generate(): Promise<TextToSpeechResult> {
    const primary = this._model ?? AiRegistry.getDefault()
    return tryWithFailover(primary, this._failover, async (modelString) => {
      const [providerName, modelId] = AiRegistry.parseModelString(modelString)
      const factory = AiRegistry.getFactory(providerName)

      if (!factory.createTts) {
        throw new Error(
          `[ai-sdk] Provider "${providerName}" does not support text-to-speech. ` +
          `Use a provider that implements createTts() (e.g. openai).`,
        )
      }

      const adapter = factory.createTts(modelId)
      return adapter.generate({
        text: this._text,
        model: modelId,
        voice: this._voice,
        speed: this._speed,
        format: this._format,
      })
    })
  }

  /** Generate audio and store it via @rudderjs/storage */
  async store(path: string): Promise<string> {
    const result = await this.generate()

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = await import(/* @vite-ignore */ '@rudderjs/storage' as string)
      const Storage = mod.Storage
      await Storage.disk().put(path, result.audio)
      return path
    } catch {
      throw new Error(
        '[ai-sdk] @rudderjs/storage is required for AudioGenerator.store(). ' +
        'Install it: pnpm add @rudderjs/storage',
      )
    }
  }
}
