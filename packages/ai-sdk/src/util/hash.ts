/**
 * cyrb53 — public-domain non-cryptographic 53-bit hash. Good distribution,
 * pure JS, no `node:crypto` needed (the AI package's main entry is
 * runtime-agnostic — see `src/isomorphic-check.test.ts`).
 *
 * Used by provider adapters to derive stable cache keys from request
 * payloads (OpenAI's `prompt_cache_key`, Google's `cachedContents/*`
 * registry). Stable hashing is the goal — not cryptographic strength.
 */
export function cyrb53Hex(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const hi = (2097151 & h2).toString(16).padStart(6, '0')
  const lo = (h1 >>> 0).toString(16).padStart(8, '0')
  return hi + lo
}
