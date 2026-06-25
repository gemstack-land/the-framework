/**
 * Run `items` through `run` with at most `limit` in flight at once.
 *
 * Before claiming each item a worker checks `shouldStop`; once it returns true,
 * no further items start (in-flight ones finish) and `stopped` is reported. The
 * returned `results` are sparse-free and index-aligned to the items that
 * actually ran — trailing items skipped by `shouldStop` are simply absent, so
 * `results.length < items.length` signals truncation.
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
