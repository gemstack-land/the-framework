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
      // Bound first: with nothing left to claim there is no work to skip, so a
      // budget met exactly by the final item is completion, not truncation.
      if (next >= items.length) return
      if (shouldStop?.()) {
        stopped = true
        return
      }
      const index = next++
      const value = await run(items[index]!, index)
      out.push({ index, value })
    }
  }

  // allSettled so one rejecting worker cannot orphan its siblings into
  // unhandled rejections; the first error is rethrown once all have drained.
  const settled = await Promise.allSettled(Array.from({ length: workers }, () => worker()))
  const failed = settled.find(s => s.status === 'rejected')
  if (failed) throw (failed as PromiseRejectedResult).reason

  out.sort((a, b) => a.index - b.index)
  return { results: out.map(o => o.value), stopped }
}
