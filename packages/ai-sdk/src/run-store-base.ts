import type { CacheAdapter } from './cache-adapter.js'

/**
 * Shared machinery behind the two public run-store families
 * ({@link AgentRunStore} for top-level `stream()` pauses,
 * {@link SubAgentRunStore} for `Agent.asTool` sub-run pauses).
 *
 * Nothing here is exported from the package entrypoint: the public surface is
 * the concrete subclasses in `agent-run-store.ts` / `sub-agent-run-store.ts`,
 * which pin the snapshot type, the default key prefix and the docs. Both
 * families store the same shape of thing under a different id, so the storage
 * mechanics live once.
 */

// ─── In-memory ─────────────────────────────────────────────

/** `Map`-backed store body. Single-process only; lossy across restarts. */
export class InMemoryRunStoreBase<S> {
  private readonly snapshots = new Map<string, S>()

  async store(id: string, snapshot: S): Promise<void> {
    this.snapshots.set(id, snapshot)
  }

  async load(id: string): Promise<S | null> {
    return this.snapshots.get(id) ?? null
  }

  async consume(id: string): Promise<S | null> {
    const snapshot = this.snapshots.get(id)
    if (!snapshot) return null
    this.snapshots.delete(id)
    return snapshot
  }

  /** Test helper — clears all snapshots without consuming. */
  clear(): void {
    this.snapshots.clear()
  }
}

// ─── Cache-backed store (bring your own CacheAdapter) ───────

/** Options shared by both cache-backed stores; each subclass re-declares its own public alias. */
export interface CachedRunStoreBaseOptions {
  cache:       CacheAdapter
  keyPrefix?:  string
  ttlSeconds?: number
}

/** Per-subclass constants: the default key namespace and the name used in the constructor error. */
export interface CachedRunStoreDefaults {
  keyPrefix: string
  storeName: string
}

/** `CacheAdapter`-backed store body. Default TTL is 5 minutes. */
export class CachedRunStoreBase<S> {
  private readonly cache:      CacheAdapter
  private readonly keyPrefix:  string
  private readonly ttlSeconds: number

  constructor(opts: CachedRunStoreBaseOptions, defaults: CachedRunStoreDefaults) {
    if (!opts?.cache) {
      throw new Error(`[ai-sdk] ${defaults.storeName} requires a cache adapter: new ${defaults.storeName}({ cache }).`)
    }
    this.cache      = opts.cache
    this.keyPrefix  = opts.keyPrefix  ?? defaults.keyPrefix
    this.ttlSeconds = opts.ttlSeconds ?? 5 * 60
  }

  async store(id: string, snapshot: S): Promise<void> {
    await this.cache.set(this.keyPrefix + id, snapshot, this.ttlSeconds)
  }

  async load(id: string): Promise<S | null> {
    // `?? null` because an off-contract adapter may resolve `undefined` on a miss
    return (await this.cache.get<S>(this.keyPrefix + id)) ?? null
  }

  async consume(id: string): Promise<S | null> {
    const key = this.keyPrefix + id
    const snapshot = await this.cache.get<S>(key)
    if (!snapshot) return null
    await this.cache.forget(key)
    return snapshot
  }
}
