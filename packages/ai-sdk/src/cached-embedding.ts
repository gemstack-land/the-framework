import type { EmbeddingAdapter, EmbeddingResult } from './types.js'

/**
 * In-memory caching wrapper for any EmbeddingAdapter.
 *
 * Caches embeddings by `model:text` key so repeated inputs skip the provider call.
 * Cache hits report zero token usage since no API call is made.
 */
export class CachedEmbeddingAdapter implements EmbeddingAdapter {
  private cache = new Map<string, number[]>()

  constructor(private inner: EmbeddingAdapter) {}

  async embed(input: string | string[], model: string): Promise<EmbeddingResult> {
    const inputs = Array.isArray(input) ? input : [input]
    const results: number[][] = []
    const uncached: string[] = []
    const uncachedIndices: number[] = []

    for (let i = 0; i < inputs.length; i++) {
      const key = `${model}:${inputs[i]}`
      const cached = this.cache.get(key)
      if (cached) {
        results[i] = cached
      } else {
        uncached.push(inputs[i]!)
        uncachedIndices.push(i)
      }
    }

    if (uncached.length > 0) {
      const fresh = await this.inner.embed(uncached, model)
      for (let j = 0; j < uncachedIndices.length; j++) {
        const idx = uncachedIndices[j]!
        const embedding = fresh.embeddings[j]!
        results[idx] = embedding
        this.cache.set(`${model}:${uncached[j]}`, embedding)
      }
    }

    return {
      embeddings: results,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }
}
