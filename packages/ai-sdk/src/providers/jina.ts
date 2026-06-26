import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  EmbeddingResult,
  RerankingAdapter,
  RerankingOptions,
  RerankingResult,
} from '../types.js'

export interface JinaConfig {
  apiKey: string
}

export class JinaProvider implements ProviderFactory {
  readonly name = 'jina'
  private readonly config: JinaConfig

  constructor(config: JinaConfig) {
    this.config = config
  }

  create(_model: string): ProviderAdapter {
    throw new Error('[ai-sdk] Jina does not support text generation. Use it for reranking and embeddings.')
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new JinaEmbeddingAdapter(this.config, model)
  }

  createReranking(model: string): RerankingAdapter {
    return new JinaRerankingAdapter(this.config, model)
  }
}

// ─── Reranking ───────────────────────────────────────────

class JinaRerankingAdapter implements RerankingAdapter {
  constructor(
    private readonly config: JinaConfig,
    private readonly model: string,
  ) {}

  async rerank(options: RerankingOptions): Promise<RerankingResult> {
    const response = await fetch('https://api.jina.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query: options.query,
        documents: options.documents,
        ...(options.topK !== undefined ? { top_n: options.topK } : {}),
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`[ai-sdk] Jina rerank failed (${response.status}): ${text}`)
    }

    const data: any = await response.json()

    return {
      results: (data.results ?? []).map((r: any) => ({
        index: r.index,
        relevanceScore: r.relevance_score,
        document: typeof r.document === 'string' ? r.document : r.document?.text ?? options.documents[r.index]!,
      })),
      usage: data.usage ? { tokens: data.usage.total_tokens } : undefined,
    }
  }
}

// ─── Embeddings ──────────────────────────────────────────

class JinaEmbeddingAdapter implements EmbeddingAdapter {
  constructor(
    private readonly config: JinaConfig,
    private readonly model: string,
  ) {}

  async embed(input: string | string[], _model: string): Promise<EmbeddingResult> {
    const texts = Array.isArray(input) ? input : [input]

    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`[ai-sdk] Jina embed failed (${response.status}): ${text}`)
    }

    const data: any = await response.json()
    const sorted = (data.data ?? []).sort((a: any, b: any) => a.index - b.index)

    return {
      embeddings: sorted.map((d: any) => d.embedding),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    }
  }
}
