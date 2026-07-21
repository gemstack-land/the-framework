import type { EmbeddingAdapter, EmbeddingResult } from '../../types.js'
import type { OpenAIConfig } from './config.js'

// ─── Embedding Adapter ────────────────────────────────────

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1'
    const inputs = Array.isArray(input) ? input : [input]

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.config.organization ? { 'OpenAI-Organization': this.config.organization } : {}),
        ...(this.config.defaultHeaders ?? {}),
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    })

    if (!res.ok) throw new Error(`[ai-sdk] OpenAI embeddings error: ${res.status} ${await res.text()}`)

    const data = await res.json() as {
      data: { embedding: number[] }[]
      usage: { prompt_tokens: number; total_tokens: number }
    }

    return {
      embeddings: data.data.map(d => d.embedding),
      usage: { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens },
    }
  }
}
