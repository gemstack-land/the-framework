/**
 * Neutral cache contract the run stores persist through.
 *
 * `@gemstack/ai-sdk` does not bundle or depend on any cache implementation.
 * Implement this small interface against whatever cache you run (Redis,
 * Memcached, a `Map`, a framework's cache layer) and pass it to
 * {@link CachedAgentRunStore} / {@link CachedSubAgentRunStore} via `{ cache }`.
 *
 * ```ts
 * const cache: CacheAdapter = {
 *   async get(key) { return JSON.parse((await redis.get(key)) ?? 'null') },
 *   async set(key, value, ttl) { await redis.set(key, JSON.stringify(value), ttl ? { EX: ttl } : undefined) },
 *   async forget(key) { await redis.del(key) },
 * }
 * const store = new CachedAgentRunStore({ cache })
 * ```
 */
export interface CacheAdapter {
  /** Read a value by key, or `null` when absent/expired. */
  get<T = unknown>(key: string): Promise<T | null>
  /** Write a value, optionally with a TTL in seconds. */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
  /** Delete a value by key. */
  forget(key: string): Promise<void>
}
