/**
 * ElevenLabs provider — premium TTS + STT (#B9).
 *
 * Implements `TextToSpeechAdapter` + `SpeechToTextAdapter` only — ElevenLabs
 * has no chat-completions surface, so `create()` throws. Apps reach this
 * provider through `AudioGenerator.of(...).model('elevenlabs/<voice_id>').generate()`
 * and `Transcription.of(...).model('elevenlabs/scribe_v1').transcribe()`.
 *
 * Wire-protocol via raw `fetch` (no SDK peer dep), matching the Jina /
 * Cohere shape. ElevenLabs's REST API is small enough that pulling in
 * `@elevenlabs/elevenlabs-js` (or any SDK) would add weight without much
 * leverage.
 *
 * @example  Config-driven (recommended)
 * ```ts
 * // config/ai.ts
 * export default {
 *   default: 'openai/gpt-4o',
 *   providers: {
 *     openai:     { driver: 'openai',     apiKey: env('OPENAI_API_KEY')! },
 *     elevenlabs: { driver: 'elevenlabs', apiKey: env('ELEVENLABS_API_KEY')! },
 *   },
 * }
 *
 * // somewhere in app code
 * await AudioGenerator
 *   .of('Hello world')
 *   .model('elevenlabs/21m00Tcm4TlvDq8ikWAM')   // voice_id (Rachel)
 *   .generate()
 * ```
 *
 * @example  Failover from OpenAI TTS to ElevenLabs
 * ```ts
 * await AudioGenerator
 *   .of('Hello')
 *   .model('openai/tts-1-hd')
 *   .failover('elevenlabs/21m00Tcm4TlvDq8ikWAM')
 *   .generate()
 * ```
 *
 * # Model strings
 *
 * **TTS:** the model string after `elevenlabs/` is the **voice id**
 * (e.g. `21m00Tcm4TlvDq8ikWAM` for Rachel). The actual TTS model
 * (`eleven_multilingual_v2`, `eleven_turbo_v2_5`, ...) defaults to
 * {@link DEFAULT_TTS_MODEL_ID}; override via `ElevenLabsConfig.defaultTtsModelId`.
 * Voice ids are the discriminator most apps want to vary per-call — the
 * underlying TTS model is usually stable per deployment.
 *
 * **STT:** the model string is the actual model id (`scribe_v1` is the
 * only model today).
 *
 * # Format mapping (TTS)
 *
 * `TextToSpeechOptions.format` maps to ElevenLabs's `output_format`:
 *
 * | Our format | ElevenLabs |
 * |---|---|
 * | `mp3` (default) | `mp3_44100_128` |
 * | `opus`          | `opus_48000_128` |
 * | `wav` / `aac` / `flac` | not supported by ElevenLabs — throws clearly |
 *
 * # Speed knob (TTS)
 *
 * `TextToSpeechOptions.speed` is **ignored** by this adapter — ElevenLabs
 * doesn't expose a top-level speed multiplier on the TTS endpoint
 * (timing is steered via `voice_settings.stability` etc., out of scope
 * for v1). OpenAI's TTS supports speed natively; failover from OpenAI
 * to ElevenLabs will produce audio at default speed.
 */

import type {
  ProviderFactory,
  ProviderAdapter,
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
} from '../types.js'

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'

/** Default TTS model when `ElevenLabsConfig.defaultTtsModelId` is unset. */
export const DEFAULT_TTS_MODEL_ID = 'eleven_multilingual_v2'

/** Default voice when no voice id is encoded into the model string and no `opts.voice` override. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

export interface ElevenLabsConfig {
  apiKey: string
  /**
   * Override `https://api.elevenlabs.io`. Useful for proxying through a
   * gateway or for self-hosted ElevenLabs-compatible APIs.
   */
  baseUrl?: string
  /**
   * The TTS model id to send in the request body. Defaults to
   * `eleven_multilingual_v2`. Override per-deployment when piloting a
   * newer model (e.g. `eleven_turbo_v2_5` for lower-latency runs).
   */
  defaultTtsModelId?: string
}

export class ElevenLabsProvider implements ProviderFactory {
  readonly name = 'elevenlabs'
  private readonly config: ElevenLabsConfig

  constructor(config: ElevenLabsConfig) {
    this.config = config
  }

  create(_model: string): ProviderAdapter {
    throw new Error('[ai-sdk] ElevenLabs does not support text generation. Use it for text-to-speech and speech-to-text.')
  }

  createTts(model: string): TextToSpeechAdapter {
    return new ElevenLabsTtsAdapter(this.config, model)
  }

  createStt(model: string): SpeechToTextAdapter {
    return new ElevenLabsSttAdapter(this.config, model)
  }
}

// ─── TTS Adapter ─────────────────────────────────────────

class ElevenLabsTtsAdapter implements TextToSpeechAdapter {
  constructor(
    private readonly config: ElevenLabsConfig,
    /**
     * Treated as a **voice id** (e.g. `21m00Tcm4TlvDq8ikWAM` for Rachel).
     * The TTS model id ships from `ElevenLabsConfig.defaultTtsModelId`.
     * Apps that want to vary the TTS model per-call should use multiple
     * registered providers (one per model) — the model-string convention
     * across @gemstack/ai-sdk is `<provider>/<voice-or-model>`.
     */
    private readonly modelOrVoiceId: string,
  ) {}

  async generate(options: TextToSpeechOptions): Promise<TextToSpeechResult> {
    const baseUrl = this.config.baseUrl ?? ELEVENLABS_BASE_URL
    const ttsModelId = this.config.defaultTtsModelId ?? DEFAULT_TTS_MODEL_ID
    // Per-call `voice` overrides whatever's encoded in the model string.
    // Falls back to the model-string voice id, then DEFAULT_VOICE_ID.
    const voiceId = options.voice ?? this.modelOrVoiceId ?? DEFAULT_VOICE_ID
    const ourFormat = options.format ?? 'mp3'
    const elevenFormat = elevenLabsOutputFormat(ourFormat)

    const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${elevenFormat}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key':   this.config.apiKey,
        'Content-Type': 'application/json',
        'Accept':       acceptForFormat(ourFormat),
      },
      body: JSON.stringify({
        text:     options.text,
        model_id: ttsModelId,
      }),
    })

    if (!response.ok) {
      const text = await safeText(response)
      throw new Error(`[ai-sdk] ElevenLabs TTS failed (${response.status}): ${text}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return {
      audio:  Buffer.from(arrayBuffer),
      format: ourFormat,
      // Returned as the voice id the caller used — that's the load-bearing
      // discriminator for ElevenLabs (TTS model id is a deployment knob).
      model:  voiceId,
    }
  }
}

// ─── STT Adapter ─────────────────────────────────────────

class ElevenLabsSttAdapter implements SpeechToTextAdapter {
  constructor(
    private readonly config: ElevenLabsConfig,
    private readonly model: string,
  ) {}

  async transcribe(options: SpeechToTextOptions): Promise<SpeechToTextResult> {
    const baseUrl = this.config.baseUrl ?? ELEVENLABS_BASE_URL
    const url = `${baseUrl}/v1/speech-to-text`

    // Multipart form with the audio Blob + the model id (+ optional language).
    // ElevenLabs's only STT model today is `scribe_v1`; the field is
    // required so we always send it.
    const form = new FormData()
    const audioBlob = new Blob([toUint8Array(options.audio)], { type: 'audio/mpeg' })
    form.append('file', audioBlob, 'audio')
    form.append('model_id', this.model)
    if (options.language) form.append('language_code', options.language)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.config.apiKey },
      body:    form,
    })

    if (!response.ok) {
      const text = await safeText(response)
      throw new Error(`[ai-sdk] ElevenLabs STT failed (${response.status}): ${text}`)
    }

    const data = await response.json() as {
      text?:           unknown
      language_code?:  unknown
      // ElevenLabs returns `words: [{ start, end, ... }]` — derive duration from the last word's end.
      words?:          Array<{ end?: unknown }>
    }

    const text     = typeof data.text === 'string' ? data.text : ''
    const language = typeof data.language_code === 'string' ? data.language_code : undefined
    const duration = lastWordEnd(data.words)

    const result: SpeechToTextResult = { text, model: this.model }
    if (language !== undefined) result.language = language
    if (duration !== undefined) result.duration = duration
    return result
  }
}

// ─── Helpers ─────────────────────────────────────────────

function elevenLabsOutputFormat(format: NonNullable<TextToSpeechOptions['format']>): string {
  switch (format) {
    case 'mp3':  return 'mp3_44100_128'
    case 'opus': return 'opus_48000_128'
    case 'wav':
    case 'aac':
    case 'flac':
      throw new Error(
        `[ai-sdk] ElevenLabs TTS does not support format '${format}'. ` +
        `Supported: 'mp3' (default), 'opus'. ` +
        `Generate the source as mp3 and re-encode if you need ${format}, or use a provider with native ${format} support.`,
      )
  }
}

function acceptForFormat(format: NonNullable<TextToSpeechOptions['format']>): string {
  switch (format) {
    case 'mp3':  return 'audio/mpeg'
    case 'opus': return 'audio/opus'
    // The throwing cases above never reach here, but TypeScript doesn't
    // know — return a neutral value so the type stays satisfied.
    default:     return 'application/octet-stream'
  }
}

function toUint8Array(audio: Uint8Array | Buffer | ArrayBuffer): Uint8Array {
  if (audio instanceof Uint8Array) return audio
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio)
  // Buffer is a Uint8Array — the typeof check above already handles it,
  // but the function signature widens for safety.
  return new Uint8Array(audio as ArrayBufferLike)
}

function lastWordEnd(words: Array<{ end?: unknown }> | undefined): number | undefined {
  if (!Array.isArray(words) || words.length === 0) return undefined
  const last = words[words.length - 1]?.end
  return typeof last === 'number' ? last : undefined
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<unreadable response body>'
  }
}
