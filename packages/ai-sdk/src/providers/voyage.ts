/**
 * VoyageAI provider — best-in-class embeddings + reranking (#B10).
 *
 * Implements `EmbeddingAdapter` + `RerankingAdapter` only — Voyage has
 * no chat-completions surface, so `create()` throws. Apps reach this
 * provider through `AI.embed(...)` and `AI.rerank(...)` (or their facade
 * equivalents).
 *
 * Wire-protocol via raw `fetch` (no SDK peer dep), matching the Jina /
 * ElevenLabs shape. Voyage's REST API is small enough that pulling in
 * an SDK would add weight without much leverage.
 *
 * @example  Config-driven (recommended)
 * ```ts
 * // config/ai.ts
 * export default {
 *   default: 'openai/gpt-4o',
 *   providers: {
 *     openai: { driver: 'openai', apiKey: env('OPENAI_API_KEY')! },
 *     voyage: { driver: 'voyage', apiKey: env('VOYAGE_API_KEY')! },
 *   },
 * }
 *
 * // somewhere in app code
 * const { embeddings } = await AI.embed('hello world', { model: 'voyage/voyage-3-large' })
 * const ranked = await AI.rerank({
 *   model:     'voyage/rerank-2.5',
 *   query:     'how do I reset my password?',
 *   documents: [...],
 *   topK:      5,
 * })
 * ```
 *
 * # Model strings
 *
 * - **Embeddings:** `voyage-3` (general), `voyage-3-large` (best quality),
 *   `voyage-code-3` (code), `voyage-finance-2` (finance), `voyage-law-2` (legal).
 * - **Reranking:** `rerank-2.5` (best), `rerank-2.5-lite`, `rerank-2`.
 *
 * # Embedding `input_type`
 *
 * Voyage embeddings perform measurably better when the API knows whether
 * a string is a search **query** or an indexed **document**. We default
 * `input_type` to `'document'` because that's the most common case for
 * RAG pipelines (matches `@gemstack/ai-sdk`'s `similaritySearch` and
 * `EmbeddingUserMemory` ingestion paths). Apps building query-side
 * pipelines should override via `inputType: 'query'` on the embed call
 * — see {@link VoyageEmbedExtras}.
 */

import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  EmbeddingResult,
  RerankingAdapter,
  RerankingOptions,
  RerankingResult,
} from '../types.js'

const VOYAGE_BASE_URL = 'https://api.voyageai.com'

/**
 * Voyage-specific extras on embed calls. Threaded through the standard
 * `EmbeddingAdapter.embed(input, model)` signature via a 3rd opt arg —
 * not exposed through `AI.embed()` directly today (would need a contract
 * widening to add `inputType` to `EmbeddingOptions`). Apps that need this
 * knob can build the adapter directly from the registry or pass via a
 * custom `Symbol.for(...)` slot in the future.
 *
 * For v1, the adapter applies a sensible default (`'document'`) and
 * exposes the override surface here as documentation.
 */
export interface VoyageEmbedExtras {
  /**
   * Voyage's `input_type` hint. `'document'` is the right default for
   * indexing pipelines (RAG ingestion); `'query'` for the search side.
   * Defaults to `'document'`.
   */
  inputType?: 'query' | 'document'
}

export interface VoyageConfig {
  apiKey: string
  /**
   * Override `https://api.voyageai.com`. Useful for proxying through a
   * gateway or for self-hosted Voyage-compatible APIs.
   */
  baseUrl?: string
  /**
   * Default `input_type` for embed calls. See {@link VoyageEmbedExtras}.
   * Per-deployment override; defaults to `'document'`.
   */
  defaultInputType?: 'query' | 'document'
}

export class VoyageProvider implements ProviderFactory {
  readonly name = 'voyage'
  private readonly config: VoyageConfig

  constructor(config: VoyageConfig) {
    this.config = config
  }

  create(_model: string): ProviderAdapter {
    throw new Error('[ai-sdk] Voyage does not support text generation. Use it for embeddings and reranking.')
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new VoyageEmbeddingAdapter(this.config, model)
  }

  createReranking(model: string): RerankingAdapter {
    return new VoyageRerankingAdapter(this.config, model)
  }
}

// ─── Embeddings ──────────────────────────────────────────

class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  constructor(
    private readonly config: VoyageConfig,
    private readonly model: string,
  ) {}

  async embed(input: string | string[], _model: string): Promise<EmbeddingResult> {
    const baseUrl   = this.config.baseUrl ?? VOYAGE_BASE_URL
    const inputType = this.config.defaultInputType ?? 'document'
    const texts     = Array.isArray(input) ? input : [input]

    const response = await fetch(`${baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model:       this.model,
        input:       texts,
        input_type:  inputType,
      }),
    })

    if (!response.ok) {
      const text = await safeText(response)
      throw new Error(`[ai-sdk] Voyage embed failed (${response.status}): ${text}`)
    }

    const data = await response.json() as {
      data?:  Array<{ embedding?: number[]; index?: number }>
      usage?: { total_tokens?: number }
    }

    // Voyage returns `data` indexed by input order — sort defensively in
    // case a future API revision returns out-of-order results.
    const sorted = (data.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    const embeddings = sorted.map(d => d.embedding ?? [])

    const totalTokens = data.usage?.total_tokens ?? 0
    return {
      embeddings,
      usage: {
        promptTokens: totalTokens,
        totalTokens,
      },
    }
  }
}

// ─── Reranking ───────────────────────────────────────────

class VoyageRerankingAdapter implements RerankingAdapter {
  constructor(
    private readonly config: VoyageConfig,
    private readonly model: string,
  ) {}

  async rerank(options: RerankingOptions): Promise<RerankingResult> {
    const baseUrl = this.config.baseUrl ?? VOYAGE_BASE_URL

    const response = await fetch(`${baseUrl}/v1/rerank`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model:     this.model,
        query:     options.query,
        documents: options.documents,
        ...(options.topK !== undefined ? { top_k: options.topK } : {}),
      }),
    })

    if (!response.ok) {
      const text = await safeText(response)
      throw new Error(`[ai-sdk] Voyage rerank failed (${response.status}): ${text}`)
    }

    const data = await response.json() as {
      data?:  Array<{ index?: number; relevance_score?: number; document?: string }>
      usage?: { total_tokens?: number }
    }

    const results = (data.data ?? []).map(r => {
      // Prefer Voyage's echoed document when present; otherwise look up
      // by index in the original input. Defensive against API revisions
      // that may toggle the echo behavior.
      const idx = r.index ?? 0
      const doc = typeof r.document === 'string' ? r.document : (options.documents[idx] ?? '')
      return {
        index:          idx,
        relevanceScore: r.relevance_score ?? 0,
        document:       doc,
      }
    })

    const totalTokens = data.usage?.total_tokens
    const result: RerankingResult = { results }
    if (totalTokens !== undefined) result.usage = { tokens: totalTokens }
    return result
  }
}

// ─── Helpers ─────────────────────────────────────────────

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<unreadable response body>'
  }
}
