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
import { lazyClient } from './lazy-client.js'

export interface CohereConfig {
  apiKey: string
}

/**
 * Builds the `cohere-ai` SDK client. The import is dynamic so the SDK stays an
 * optional dependency that is only resolved once a Cohere adapter is used.
 */
async function createCohereClient(config: CohereConfig): Promise<any> {
  const sdk: any = await import(/* @vite-ignore */ 'cohere-ai' as string)
  const CohereClientV2 = sdk.CohereClientV2 ?? sdk.default?.CohereClientV2
  return new CohereClientV2({ token: config.apiKey })
}

export class CohereProvider implements ProviderFactory {
  readonly name = 'cohere'
  private readonly config: CohereConfig

  constructor(config: CohereConfig) {
    this.config = config
  }

  create(_model: string): ProviderAdapter {
    throw new Error('[ai-sdk] Cohere does not support text generation. Use it for reranking and embeddings.')
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
  constructor(
    private readonly config: CohereConfig,
    private readonly model: string,
  ) {}

  private readonly getClient = lazyClient(() => createCohereClient(this.config))

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
  constructor(
    private readonly config: CohereConfig,
    private readonly model: string,
  ) {}

  private readonly getClient = lazyClient(() => createCohereClient(this.config))

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
