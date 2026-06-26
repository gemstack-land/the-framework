import { AiRegistry, _onAiRegistryReset } from './registry.js'
import { agent as agentHelper } from './agent.js'
import { ImageGenerator } from './image.js'
import { AudioGenerator } from './audio.js'
import { Transcription } from './transcription.js'
import { Reranker } from './rerank.js'
import { FileManager } from './files.js'
import { CachedEmbeddingAdapter } from './cached-embedding.js'
import type { Agent } from './agent.js'
import type { AgentResponse, AnyTool, AiMiddleware, EmbeddingAdapter, EmbeddingResult, RerankingResult } from './types.js'

/**
 * AI facade — static entry point for quick prompts, embeddings, and image generation.
 *
 * @example
 * const response = await AI.prompt('Hello')
 * const a = AI.agent('You are helpful.')
 * const result = await AI.embed('Some text')
 * const image = await AI.image('A sunset').generate()
 */
export class AI {
  /** Quick prompt with default model */
  static async prompt(input: string, options?: { model?: string | undefined }): Promise<AgentResponse> {
    const opts: { instructions: string; model?: string | undefined } = {
      instructions: 'You are a helpful assistant.',
    }
    if (options?.model) opts.model = options.model
    return agentHelper(opts).prompt(input)
  }

  /** Create an anonymous agent */
  static agent(
    instructionsOrOptions: string | {
      instructions: string
      tools?: AnyTool[] | undefined
      model?: string | undefined
      middleware?: AiMiddleware[] | undefined
    },
  ): Agent {
    return agentHelper(instructionsOrOptions)
  }

  /** Create an image generator with a fluent API */
  static image(prompt: string): ImageGenerator {
    return ImageGenerator.of(prompt)
  }

  /** Create a text-to-speech audio generator */
  static audio(text: string): AudioGenerator {
    return AudioGenerator.of(text)
  }

  /**
   * Create a speech-to-text transcription from raw audio bytes.
   *
   * For Node-only path-based loading, use `transcribeFromPath` from `@gemstack/ai-sdk/node`.
   */
  static transcribe(bytes: Uint8Array): Transcription {
    return Transcription.fromBytes(bytes)
  }

  /**
   * Rerank documents by relevance to a query.
   *
   * Returns a fluent builder when called with just query + documents.
   * Pass `options` for a one-shot call.
   *
   * @example
   * const result = await AI.rerank('search query', documents)
   * const result = await AI.rerank('query', docs, { model: 'cohere/rerank-v3.5', topK: 5 })
   */
  static rerank(query: string, documents: string[]): Reranker
  static rerank(query: string, documents: string[], options: { model?: string | undefined; topK?: number | undefined }): Promise<RerankingResult>
  static rerank(
    query: string,
    documents: string[],
    options?: { model?: string | undefined; topK?: number | undefined },
  ): Reranker | Promise<RerankingResult> {
    const builder = Reranker.of(query, documents)
    if (!options) return builder
    if (options.model) builder.model(options.model)
    if (options.topK) builder.topK(options.topK)
    return builder.rank()
  }

  /**
   * Get a file manager for a provider.
   *
   * @example
   * const files = AI.files('openai')
   * const uploaded = await files.upload('./report.pdf', { purpose: 'assistants' })
   * const list = await files.list()
   * await files.delete(uploaded.id)
   */
  static files(provider?: string): FileManager {
    const providerName = provider ?? AiRegistry.parseModelString(AiRegistry.getDefault())[0]
    return FileManager.for(providerName)
  }

  /**
   * Generate embeddings for text.
   *
   * Large arrays (100+ items) are automatically chunked into batches.
   * Pass `cache: true` to enable in-memory caching of embeddings.
   *
   * @example
   * const result = await AI.embed('Hello world')
   * const result = await AI.embed(['text1', 'text2'])
   * const result = await AI.embed('text', { model: 'openai/text-embedding-3-small' })
   * const result = await AI.embed('text', { cache: true })
   */
  static async embed(
    input: string | string[],
    options?: { model?: string | undefined; cache?: boolean | undefined },
  ): Promise<EmbeddingResult> {
    const modelString = options?.model ?? AiRegistry.getDefault()
    const [providerName, modelId] = AiRegistry.parseModelString(modelString)
    const factory = AiRegistry.getFactory(providerName)

    if (!factory.createEmbedding) {
      throw new Error(
        `[ai-sdk] Provider "${providerName}" does not support embeddings. ` +
        `Use a provider that implements createEmbedding() (e.g. openai, google, mistral).`,
      )
    }

    let adapter: EmbeddingAdapter
    if (options?.cache) {
      adapter = AI.getCachedAdapter(providerName, modelId, () => factory.createEmbedding!(modelId))
    } else {
      adapter = factory.createEmbedding(modelId)
    }

    // Batch chunking for large arrays
    const inputs = Array.isArray(input) ? input : [input]
    if (inputs.length > 100) {
      const batches: string[][] = []
      for (let i = 0; i < inputs.length; i += 100) {
        batches.push(inputs.slice(i, i + 100))
      }
      const results: EmbeddingResult[] = []
      for (const batch of batches) {
        results.push(await adapter.embed(batch, modelId))
      }
      return {
        embeddings: results.flatMap(r => r.embeddings),
        usage: {
          promptTokens: results.reduce((sum, r) => sum + r.usage.promptTokens, 0),
          totalTokens: results.reduce((sum, r) => sum + r.usage.totalTokens, 0),
        },
      }
    }

    return adapter.embed(inputs.length === 1 ? inputs[0]! : inputs, modelId)
  }

  /**
   * Cache `CachedEmbeddingAdapter` instances keyed by `<provider>::<model>` so
   * the in-memory cache persists across `AI.embed(..., { cache: true })` calls.
   *
   * The earlier `WeakMap<EmbeddingAdapter, CachedEmbeddingAdapter>` keyed on
   * adapter identity, but every `embed()` call constructed a fresh inner
   * adapter via `factory.createEmbedding(modelId)` — so the WeakMap lookup
   * always missed and `{ cache: true }` was a silent no-op. Keying by
   * `(provider, model)` is the only stable identity we have at this layer.
   *
   * Tied to `AiRegistry.reset()` so tests that swap fakes between resets
   * don't bind to a stale inner adapter.
   */
  private static cachedAdapters = new Map<string, CachedEmbeddingAdapter>()

  private static getCachedAdapter(
    provider: string,
    model: string,
    create: () => EmbeddingAdapter,
  ): CachedEmbeddingAdapter {
    const key = `${provider}::${model}`
    let cached = AI.cachedAdapters.get(key)
    if (!cached) {
      cached = new CachedEmbeddingAdapter(create())
      AI.cachedAdapters.set(key, cached)
    }
    return cached
  }

  /** @internal — exposed for the reset-listener subscription below. */
  static _clearEmbeddingCache(): void { AI.cachedAdapters.clear() }
}

_onAiRegistryReset(() => AI._clearEmbeddingCache())
