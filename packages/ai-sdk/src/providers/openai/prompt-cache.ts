import type { CacheableMarkers } from '../../types.js'
import { cyrb53Hex } from '../../util/hash.js'

// ─── Prompt-cache key ────────────────────────────────────
//
// OpenAI caches prompts automatically once they exceed 1024 tokens. The only
// SDK knob is `prompt_cache_key`: an opaque string that gives OpenAI a routing
// hint so requests with the same cacheable prefix land on the same backend
// (which has the prefix already cached). Stable hashing is the goal — not
// cryptographic strength — so we use cyrb53 over canonical JSON of the
// regions the agent declared as `cacheable()`.
//
// Spec: https://platform.openai.com/docs/guides/prompt-caching

/**
 * Build a stable `prompt_cache_key` from the regions the agent marked as
 * cacheable. Returns `undefined` if no markers apply (request goes out
 * without a cache key — OpenAI still caches automatically above 1024
 * tokens, just without routing affinity).
 *
 * Exported for unit testing.
 */
export function buildPromptCacheKey(
  messages: unknown[],
  tools: unknown[] | undefined,
  cache: CacheableMarkers | undefined,
): string | undefined {
  if (!cache) return undefined

  const parts: unknown[] = []

  if (cache.instructions) {
    const sys = messages.find(m => (m as { role?: string }).role === 'system')
    if (sys) parts.push({ s: (sys as { content: unknown }).content })
  }

  if (cache.tools && tools && tools.length > 0) {
    parts.push({ t: tools })
  }

  if (cache.messages && cache.messages > 0) {
    const conv = messages.filter(m => (m as { role?: string }).role !== 'system')
    const sliced = conv.slice(0, cache.messages)
    if (sliced.length > 0) parts.push({ m: sliced })
  }

  if (parts.length === 0) return undefined

  return cyrb53Hex(JSON.stringify(parts))
}
