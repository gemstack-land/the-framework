export interface LazyClient<T> {
  (): Promise<T>
  /** Test seam: inject a client so the dynamic SDK import is never made. */
  set(client: T): void
}

/**
 * Memoise a lazily-built SDK client.
 *
 * Every adapter resolves its SDK through a dynamic import so the dependency
 * stays optional and is only paid for once the provider is actually used.
 * The in-flight promise is cached too, so two concurrent first calls share one
 * client instead of racing to construct two.
 */
export function lazyClient<T>(build: () => Promise<T>): LazyClient<T> {
  let pending: Promise<T> | undefined
  const get = (() => {
    // A failed import must not poison later calls, so drop the cache on reject.
    pending ??= build().catch(err => {
      pending = undefined
      throw err
    })
    return pending
  }) as LazyClient<T>
  get.set = client => {
    pending = Promise.resolve(client)
  }
  return get
}
