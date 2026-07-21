import type {
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../../types.js'
import type { GoogleConfig } from './config.js'

// ─── Image Generation Adapter (Imagen) ──────────────────

const GOOGLE_IMAGE_SIZE_MAP: Record<string, string> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
}

export class GoogleImageAdapter implements ImageGenerationAdapter {
  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const size = options.size
      ? (GOOGLE_IMAGE_SIZE_MAP[options.size] ?? options.size)
      : '1024x1024'

    const [width, height] = size.split('x').map(Number)

    const body: Record<string, unknown> = {
      instances: [{ prompt: options.prompt }],
      parameters: {
        sampleCount: options.n ?? 1,
        ...(width && height ? { aspectRatio: `${width}:${height}` } : {}),
      },
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.config.apiKey}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`[ai-sdk] Google image generation error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
    }

    return {
      images: (data.predictions ?? []).map((p: any) => ({
        ...(p.bytesBase64Encoded ? { base64: p.bytesBase64Encoded as string } : {}),
      })),
      model: this.model,
    }
  }
}
