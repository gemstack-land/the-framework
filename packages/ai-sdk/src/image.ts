import { AiRegistry, tryWithFailover } from './registry.js'
import { fromBase64 } from './base64.js'
import type { ImageGenerationOptions, ImageGenerationResult } from './types.js'

/**
 * Fluent image generation facade.
 *
 * @example
 * const result = await ImageGenerator.of('A sunset over mountains').size('landscape').generate()
 * const path = await ImageGenerator.of('A logo').model('openai/dall-e-3').store('images/logo.png')
 *
 * @example  Failover across providers
 * const result = await ImageGenerator.of('A donut')
 *   .model('openai/dall-e-3')
 *   .failover('google/imagen-3', 'azure/dall-e-3')
 *   .generate()
 */
export class ImageGenerator {
  private _model: string | undefined
  private _size: string | undefined
  private _quality: 'standard' | 'hd' | undefined
  private _style: 'natural' | 'vivid' | undefined
  private _n: number | undefined
  private _failover: string[] = []

  private constructor(private readonly _prompt: string) {}

  static of(prompt: string): ImageGenerator {
    return new ImageGenerator(prompt)
  }

  model(model: string): this {
    this._model = model
    return this
  }

  /**
   * Provider/model strings to try if the primary fails.
   * Tried in order; the first to succeed wins. Swallows individual errors,
   * surfaces only the last one if every candidate fails.
   */
  failover(...models: string[]): this {
    this._failover = models
    return this
  }

  size(size: string): this {
    this._size = size
    return this
  }

  quality(quality: 'standard' | 'hd'): this {
    this._quality = quality
    return this
  }

  style(style: 'natural' | 'vivid'): this {
    this._style = style
    return this
  }

  count(n: number): this {
    this._n = n
    return this
  }

  async generate(): Promise<ImageGenerationResult> {
    const primary = this._model ?? AiRegistry.getDefault()
    return tryWithFailover(primary, this._failover, async (modelStr) => {
      const [providerName, modelName] = AiRegistry.parseModelString(modelStr)
      const factory = AiRegistry.getFactory(providerName)

      if (!factory.createImage) {
        throw new Error(`[ai-sdk] Provider "${providerName}" does not support image generation.`)
      }

      const adapter = factory.createImage(modelName)

      const options: ImageGenerationOptions = {
        prompt: this._prompt,
        model: modelStr,
      }
      if (this._size !== undefined) options.size = this._size
      if (this._quality !== undefined) options.quality = this._quality
      if (this._style !== undefined) options.style = this._style
      if (this._n !== undefined) options.n = this._n

      return adapter.generate(options)
    })
  }

  /** Generate and store the first image to storage. Requires @rudderjs/storage. */
  async store(path: string): Promise<string> {
    const result = await this.generate()
    const image = result.images[0]
    if (!image) throw new Error('[ai-sdk] No image generated.')

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod: any = await import(/* @vite-ignore */ '@rudderjs/storage' as string)
      const Storage = mod.Storage

      if (image.base64) {
        const bytes = fromBase64(image.base64)
        await Storage.put(path, bytes)
      } else if (image.url) {
        const response = await fetch(image.url)
        const bytes = new Uint8Array(await response.arrayBuffer())
        await Storage.put(path, bytes)
      }

      return path
    } catch {
      throw new Error('[ai-sdk] Image storage requires @rudderjs/storage to be installed.')
    }
  }
}
