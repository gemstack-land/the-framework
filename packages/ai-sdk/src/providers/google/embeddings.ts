import type { EmbeddingAdapter, EmbeddingResult } from '../../types.js'
import type { GoogleConfig } from './config.js'
import { createGoogleClient } from './client.js'
import { lazyClient } from '../lazy-client.js'

// ─── Embedding Adapter ──────────────────────────────────

export class GoogleEmbeddingAdapter implements EmbeddingAdapter {
  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  private readonly getClient = lazyClient(() => createGoogleClient(this.config))

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const client = await this.getClient()
    const inputs = Array.isArray(input) ? input : [input]

    const results = await Promise.all(
      inputs.map(text =>
        client.models.embedContent({
          model: this.model,
          content: { parts: [{ text }] },
        }),
      ),
    )

    const embeddings = results.map((r: any) => r.embedding?.values ?? [])

    return {
      embeddings,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }
}
