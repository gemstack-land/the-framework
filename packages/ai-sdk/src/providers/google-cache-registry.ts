import { cyrb53Hex } from '../util/hash.js'

/**
 * Minimal structural shape of a cache store the registry can use. Matches
 * `@rudderjs/cache`'s `CacheAdapter` (see `packages/cache/src/index.ts`)
 * for the methods we touch. Defined locally so this file (which lives in
 * the runtime-agnostic main entry) doesn't take a cross-package dep — the
 * AiProvider hands in the real adapter at boot.
 */
export interface CacheStoreLike {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  forget(key: string): Promise<void>
}

interface CacheEntry { name: string; expiresAt: number }
interface TooSmallEntry { tooSmall: true; expiresAt: number }
type StoredEntry = CacheEntry | TooSmallEntry

const TOO_SMALL_TTL_MS = 5 * 60 * 1000      // 5 minutes — Q4 in plan
const KEY_PREFIX = 'rudderjs:ai:google-cache:'

export interface GoogleCacheRegistryOptions {
  /** Optional cache backend (cross-process / cross-restart). Falls back to in-process Map. */
  store?: CacheStoreLike
  /** Default TTL for newly-created Google `cachedContent` resources. Default `'1h'`. */
  defaultTtl?: string
  /**
   * Test-only override for the wall clock — pass `() => fakeNow` from tests.
   * Production code never sets this.
   * @internal
   */
  now?: () => number
}

export interface ResolveArgs {
  /** Live `@google/genai` client. */
  client:             GoogleClientLike
  /** Model id the request is going to. Caches are model-bound. */
  model:              string
  /** Stable hash of cached regions (system + tools + leading-N messages, by model). */
  cacheKey:           string
  systemInstruction?: { parts: { text: string }[] } | undefined
  contents?:          unknown[] | undefined
  tools?:             unknown[] | undefined
  /** Override the registry's default TTL for this call. Duration string. */
  ttl?:               string | undefined
}

export interface GoogleClientLike {
  caches: {
    create(args: {
      model: string
      config: {
        systemInstruction?: { parts: { text: string }[] }
        contents?:          unknown[]
        tools?:             unknown[]
        ttl?:               string
        displayName?:       string
      }
    }): Promise<{ name: string; expireTime?: string }>
    delete?(args: { name: string }): Promise<void>
  }
}

/**
 * Owns the `cacheKey → cachedContents/*` resource-name map for the Google
 * provider. Coordinates concurrent creates, memoizes "too-small" failures,
 * and drops stale entries on demand (so the adapter can recreate-on-404).
 *
 * Storage is pluggable: the AiProvider passes a `CacheStoreLike` (typically
 * `@rudderjs/cache`'s adapter) when available, otherwise the registry uses
 * an in-process `Map` and warns once. Either way, in-process locking keeps
 * concurrent same-key requests from racing on `caches.create` within one
 * worker.
 */
export class GoogleCacheRegistry {
  private readonly store?:    CacheStoreLike
  private readonly memory =   new Map<string, StoredEntry>()
  private readonly inFlight = new Map<string, Promise<string | null>>()
  private readonly defaultTtl: string
  private readonly now:       () => number
  private warnedNoStore =     false

  constructor(opts: GoogleCacheRegistryOptions = {}) {
    if (opts.store) this.store = opts.store
    this.defaultTtl = opts.defaultTtl ?? '1h'
    this.now = opts.now ?? Date.now
  }

  /**
   * Returns the `cachedContents/*` resource name for `args.cacheKey`,
   * creating a Google cache resource if one doesn't exist yet. Returns
   * `null` when the prompt is below the model's minimum-cacheable size
   * (the failure is memoized for ~5min so a tight loop doesn't pound the
   * create endpoint).
   */
  async resolve(args: ResolveArgs): Promise<string | null> {
    const storeKey = KEY_PREFIX + args.cacheKey

    const existing = await this.lookup(storeKey)
    if (existing) {
      if ('tooSmall' in existing) return null
      return existing.name
    }

    // In-process dedup — same-worker concurrent calls share one create.
    const pending = this.inFlight.get(storeKey)
    if (pending) return pending

    const work = (async () => {
      try {
        const cache = await args.client.caches.create({
          model: args.model,
          config: {
            ...(args.systemInstruction ? { systemInstruction: args.systemInstruction } : {}),
            ...(args.contents ? { contents: args.contents } : {}),
            ...(args.tools    ? { tools:    args.tools }    : {}),
            ttl: args.ttl ?? this.defaultTtl,
            displayName: `rudderjs:${args.cacheKey}`,
          },
        })
        await this.remember(storeKey, { name: cache.name, expiresAt: this.expiryFromTtl(args.ttl ?? this.defaultTtl) })
        return cache.name
      } catch (err) {
        if (isTooSmallError(err)) {
          await this.remember(storeKey, { tooSmall: true, expiresAt: this.now() + TOO_SMALL_TTL_MS })
          console.warn(
            `[ai-sdk] Google cache for hash ${args.cacheKey} below model minimum — running uncached. ` +
            `Future calls with the same prefix will skip cache attempts for 5m.`,
          )
          return null
        }
        // Any other error — let the caller fall back to uncached for THIS request,
        // but don't poison the registry with a "tooSmall" entry.
        console.warn(`[ai-sdk] Google caches.create failed for hash ${args.cacheKey} — running uncached. ${(err as Error).message}`)
        return null
      } finally {
        this.inFlight.delete(storeKey)
      }
    })()

    this.inFlight.set(storeKey, work)
    return work
  }

  /**
   * Drop a cached entry — used when `generateContent` returns 404 because
   * the resource expired between create and use. The adapter recreates by
   * calling `resolve()` again.
   */
  async forget(cacheKey: string): Promise<void> {
    const storeKey = KEY_PREFIX + cacheKey
    this.memory.delete(storeKey)
    if (this.store) await this.store.forget(storeKey)
  }

  // ─── Internals ──────────────────────────────────────────

  private async lookup(storeKey: string): Promise<StoredEntry | null> {
    if (this.store) {
      const entry = await this.store.get<StoredEntry>(storeKey)
      if (entry && entry.expiresAt > this.now()) return entry
      if (entry) await this.store.forget(storeKey)
      return null
    }
    if (!this.warnedNoStore) {
      this.warnedNoStore = true
      console.warn(
        '[ai-sdk] Google prompt caching is using in-memory storage; ' +
        'install @rudderjs/cache for cross-process/restart persistence.',
      )
    }
    const entry = this.memory.get(storeKey)
    if (!entry) return null
    if (entry.expiresAt > this.now()) return entry
    this.memory.delete(storeKey)
    return null
  }

  private async remember(storeKey: string, entry: StoredEntry): Promise<void> {
    if (this.store) {
      const ttlSeconds = Math.max(1, Math.ceil((entry.expiresAt - this.now()) / 1000))
      await this.store.set(storeKey, entry, ttlSeconds)
      return
    }
    this.memory.set(storeKey, entry)
  }

  private expiryFromTtl(ttl: string): number {
    return this.now() + parseDurationMs(ttl)
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Build a stable cache key for a Google request. The key combines the
 * model id with the marked regions — switching models invalidates the
 * cache (Google ties resources to a single model id).
 */
export function buildGoogleCacheKey(
  model:    string,
  cache:    { instructions?: boolean; tools?: boolean; messages?: number } | undefined,
  system:   string | undefined,
  contents: unknown[],
  tools:    unknown[] | undefined,
): string | undefined {
  if (!cache) return undefined
  const parts: unknown[] = [{ model }]
  if (cache.instructions && system) parts.push({ s: system })
  if (cache.tools && tools && tools.length > 0) parts.push({ t: tools })
  if (cache.messages && cache.messages > 0) {
    const sliced = contents.slice(0, cache.messages)
    if (sliced.length > 0) parts.push({ m: sliced })
  }
  if (parts.length === 1) return undefined  // only `{ model }` — no actual region
  return cyrb53Hex(JSON.stringify(parts))
}

/**
 * Split a `contents` array at the cache breakpoint. The first part is what
 * lives inside the cached resource; the second part is what the request
 * sends fresh on every call.
 */
export function splitContentsAtCache(
  contents: unknown[],
  cache:    { messages?: number } | undefined,
): { cached: unknown[]; fresh: unknown[] } {
  const n = Math.max(0, Math.min(contents.length, cache?.messages ?? 0))
  return {
    cached: contents.slice(0, n),
    fresh:  contents.slice(n),
  }
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i

/**
 * Parse a duration string into milliseconds. Accepts plain seconds-string
 * (`'3600s'`) or compact units (`'1h'`, `'30m'`, `'1d'`). Falls back to
 * 1 hour on unparseable input.
 */
function parseDurationMs(s: string): number {
  const m = DURATION_RE.exec(s.trim())
  if (!m) return 60 * 60 * 1000
  const n = Number(m[1])
  const unit = (m[2] ?? 'h').toLowerCase()
  switch (unit) {
    case 'ms': return n
    case 's':  return n * 1000
    case 'm':  return n * 60 * 1000
    case 'h':  return n * 60 * 60 * 1000
    case 'd':  return n * 24 * 60 * 60 * 1000
    default:   return 60 * 60 * 1000
  }
}

/**
 * Convert a duration string to the Google API's `Ns` format (seconds with
 * an `s` suffix). Used when forwarding `ttl` to `caches.create`.
 *
 * @internal exported for tests
 */
export function durationToGoogleTtl(s: string): string {
  return `${Math.max(1, Math.ceil(parseDurationMs(s) / 1000))}s`
}

function isTooSmallError(err: unknown): boolean {
  if (!err) return false
  const msg = String((err as { message?: string }).message ?? err).toLowerCase()
  // Google returns INVALID_ARGUMENT with "minimum input token count" or similar wording.
  return msg.includes('minimum') && (msg.includes('token') || msg.includes('input'))
}

function isNotFoundError(err: unknown): boolean {
  if (!err) return false
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code
  if (status === 404) return true
  const msg = String((err as { message?: string }).message ?? err).toLowerCase()
  return msg.includes('not found') || msg.includes('404')
}

export const _internals = { isTooSmallError, isNotFoundError, parseDurationMs }
