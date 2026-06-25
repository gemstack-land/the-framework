import { OpenAIAdapter } from './openai.js'
import type { ProviderFactory, ProviderAdapter, EmbeddingAdapter, EmbeddingResult } from '../types.js'

export interface MistralConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class MistralProvider implements ProviderFactory {
  readonly name = 'mistral'
  private readonly config: MistralConfig

  constructor(config: MistralConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(
      {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl ?? 'https://api.mistral.ai/v1',
      },
      model,
    )
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new MistralEmbeddingAdapter(this.config, model)
  }
}

// ─── Embedding Adapter ──────────────────────────────────

class MistralEmbeddingAdapter implements EmbeddingAdapter {
  constructor(
    private readonly config: MistralConfig,
    private readonly model: string,
  ) {}

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const baseUrl = this.config.baseUrl ?? 'https://api.mistral.ai/v1'
    const inputs = Array.isArray(input) ? input : [input]

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    })

    if (!res.ok) throw new Error(`[Rudder AI] Mistral embeddings error: ${res.status} ${await res.text()}`)

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
