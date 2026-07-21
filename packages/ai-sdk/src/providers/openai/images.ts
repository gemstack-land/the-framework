import type {
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../../types.js'
import type { OpenAIConfig } from './config.js'

// ─── Image Generation Adapter ────────────────────────────

const IMAGE_SIZE_MAP: Record<string, string> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
}

export class OpenAIImageAdapter implements ImageGenerationAdapter {
  private client: any = null

  constructor(
    private readonly config: OpenAIConfig,
    private readonly model: string,
  ) {}

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

  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const client = await this.getClient()

    const size = options.size
      ? (IMAGE_SIZE_MAP[options.size] ?? options.size)
      : '1024x1024'

    const params: Record<string, unknown> = {
      model: this.model,
      prompt: options.prompt,
      size,
      response_format: 'b64_json',
    }
    if (options.n !== undefined) params['n'] = options.n
    if (options.quality) params['quality'] = options.quality
    if (options.style) params['style'] = options.style

    const response = await client.images.generate(params)

    return {
      images: (response.data ?? []).map((img: any) => ({
        ...(img.b64_json ? { base64: img.b64_json } : {}),
        ...(img.url ? { url: img.url } : {}),
        ...(img.revised_prompt ? { revisedPrompt: img.revised_prompt } : {}),
      })),
      model: this.model,
    }
  }
}
