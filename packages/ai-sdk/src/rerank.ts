import { AiRegistry } from './registry.js'
import type { RerankingResult } from './types.js'

/**
 * Fluent reranking builder.
 *
 * @example
 * const result = await Reranker.of('search query', documents).topK(5).rank()
 * const result = await Reranker.of('query', docs).model('cohere/rerank-v3.5').rank()
 */
export class Reranker {
  private _model: string | undefined
  private _topK: number | undefined

  private constructor(
    private readonly _query: string,
    private readonly _documents: string[],
  ) {}

  static of(query: string, documents: string[]): Reranker {
    return new Reranker(query, documents)
  }

  model(model: string): this {
    this._model = model
    return this
  }

  topK(k: number): this {
    this._topK = k
    return this
  }

  async rank(): Promise<RerankingResult> {
    const modelStr = this._model ?? AiRegistry.getDefault()
    const adapter = AiRegistry.resolveReranking(modelStr)

    return adapter.rerank({
      query: this._query,
      documents: this._documents,
      model: modelStr,
      topK: this._topK,
    })
  }
}
