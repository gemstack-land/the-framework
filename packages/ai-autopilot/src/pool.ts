/**
 * Run `items` through `run` with at most `limit` in flight at once.
 *
 * Before claiming each item a worker checks `shouldStop`; once it returns true,
 * no further items start (in-flight ones finish) and `stopped` is reported. The
 * returned `results` are sparse-free and ordered by item index — trailing items
 * skipped by `shouldStop` are simply absent, so `results.length < items.length`
 * signals truncation.
 *
 * @internal Not part of the public API; used by {@link Supervisor}. Import is
 * not re-exported from the package entry and may change without a major bump.
 *
 * @param items  The work items to process.
 * @param limit  Max concurrent workers (clamped to `[1, items.length]`).
 * @param run    Async processor for one item; receives the item and its index.
 * @param shouldStop  Optional predicate checked before each claim; `true` stops new work.
 * @returns `results` (index-ordered, only items that ran) and `stopped` (whether `shouldStop` fired).
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<{ results: R[]; stopped: boolean }> {
  const out: Array<{ index: number; value: R }> = []
  let next = 0
  let stopped = false

  const workers = Math.max(1, Math.min(limit, items.length))

  async function worker(): Promise<void> {
    while (true) {
      if (shouldStop?.()) {
        stopped = true
        return
      }
      const index = next++
      if (index >= items.length) return
      const value = await run(items[index]!, index)
      out.push({ index, value })
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))

  out.sort((a, b) => a.index - b.index)
  return { results: out.map(o => o.value), stopped }
}
