import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  EmbeddingAdapter,
  EmbeddingResult,
  RerankingAdapter,
  RerankingOptions,
  RerankingResult,
} from '../types.js'

export interface CohereConfig {
  apiKey: string
}

export class CohereProvider implements ProviderFactory {
  readonly name = 'cohere'
  private readonly config: CohereConfig

  constructor(config: CohereConfig) {
    this.config = config
  }

  create(_model: string): ProviderAdapter {
    throw new Error('[Rudder AI] Cohere does not support text generation. Use it for reranking and embeddings.')
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new CohereEmbeddingAdapter(this.config, model)
  }

  createReranking(model: string): RerankingAdapter {
    return new CohereRerankingAdapter(this.config, model)
  }
}

// ─── Reranking ───────────────────────────────────────────

class CohereRerankingAdapter implements RerankingAdapter {
  private client: any = null

  constructor(
    private readonly config: CohereConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ 'cohere-ai' as string)
    const CohereClientV2 = sdk.CohereClientV2 ?? sdk.default?.CohereClientV2
    this.client = new CohereClientV2({ token: this.config.apiKey })
    return this.client
  }

  async rerank(options: RerankingOptions): Promise<RerankingResult> {
    const client = await this.getClient()

    const response = await client.rerank({
      model: this.model,
      query: options.query,
      documents: options.documents.map(d => ({ text: d })),
      ...(options.topK !== undefined ? { topN: options.topK } : {}),
    })

    return {
      results: (response.results ?? []).map((r: any) => ({
        index: r.index,
        relevanceScore: r.relevanceScore,
        document: options.documents[r.index]!,
      })),
    }
  }
}

// ─── Embeddings ──────────────────────────────────────────

class CohereEmbeddingAdapter implements EmbeddingAdapter {
  private client: any = null

  constructor(
    private readonly config: CohereConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ 'cohere-ai' as string)
    const CohereClientV2 = sdk.CohereClientV2 ?? sdk.default?.CohereClientV2
    this.client = new CohereClientV2({ token: this.config.apiKey })
    return this.client
  }

  async embed(input: string | string[], _model: string): Promise<EmbeddingResult> {
    const client = await this.getClient()
    const texts = Array.isArray(input) ? input : [input]

    const response = await client.embed({
      model: this.model,
      texts,
      inputType: 'search_document',
      embeddingTypes: ['float'],
    })

    const embeddings: number[][] = response.embeddings?.float ?? []

    return {
      embeddings,
      usage: {
        promptTokens: response.meta?.billedUnits?.inputTokens ?? 0,
        totalTokens: response.meta?.billedUnits?.inputTokens ?? 0,
      },
    }
  }
}
