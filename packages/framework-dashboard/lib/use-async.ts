import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

// Every panel here reads the same way: ask the daemon, hold the answer, drop it on the
// floor if the component moved on. That was written out 12 times, and only the usage
// panel remembered to catch — so a daemon restart made every other tick an unhandled
// rejection. These two hooks are that pattern, once.

/**
 * A rejected read keeps the last value rather than blanking it, which is what the usage
 * panel already did deliberately: an empty bar reads as "nothing used" rather than "no
 * answer". The next tick usually succeeds.
 */
function useAsyncValue<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  everyMs: number | null,
  deps: DependencyList,
  keepPrevious = false,
): { value: T; reload: () => void; loaded: boolean } {
  const [value, setValue] = useState<T>(initial)
  // Whether `value` is an answer rather than the initial. Only a successful read sets it, so a
  // caller that reads absence as a fact ("is this session gone, or just not fetched yet?", #784)
  // never mistakes a daemon hiccup for an answer.
  const [loaded, setLoaded] = useState(false)
  // Captured once, like useState's own initial: it is also what a dep change resets to,
  // and callers pass literals like `[]` that would otherwise be a new value every render.
  const initialRef = useRef(initial)
  // A dep change and an unmount both retire the in-flight read. `reload` reads the same
  // token, so an imperative refetch can't write back after either.
  const liveRef = useRef({ live: false })

  const apply = useCallback((token: { live: boolean }, run: () => Promise<T>) => {
    void run()
      .then(next => {
        if (!token.live) return
        setValue(next)
        setLoaded(true)
      })
      .catch(() => {
        // Keep whatever we last showed; the next read may well succeed.
      })
  }, [])

  useEffect(() => {
    const token = { live: true }
    liveRef.current = token
    // A switch normally shows nothing rather than the last target's data. `keepPrevious` opts out:
    // the toolbar keeps its resolved header (branch/PR/github) visible while the next one loads, so
    // navigating between sessions updates it in place instead of blanking and popping (the flicker).
    if (!keepPrevious) setValue(initialRef.current)
    setLoaded(false)
    if (!load) return () => void (token.live = false)
    const run = (): void => apply(token, load)
    run()
    if (everyMs === null) return () => void (token.live = false)
    const timer = setInterval(run, everyMs)
    return () => {
      token.live = false
      clearInterval(timer)
    }
    // The caller owns the dep list: `load` closes over exactly these, by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const reload = useCallback(() => {
    if (!load) return
    apply(liveRef.current, load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { value, reload, loaded }
}

/**
 * Read once, and again whenever `deps` change.
 *
 * Pass `null` for `load` when there is nothing to read yet (no project selected): the
 * value stays `initial` and no read is made. `load` must close over exactly `deps`.
 */
export function useLoaded<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  deps: DependencyList,
  keepPrevious = false,
): T {
  return useAsyncValue(load, initial, null, deps, keepPrevious).value
}

/**
 * Read now, again every `everyMs`, and again whenever `deps` change. Polling stops on
 * unmount. `reload` reads immediately, for when a local action means the next tick is
 * too late to wait for.
 *
 * Pass `null` for `load` when there is nothing to read yet. `load` must close over
 * exactly `deps`. `loaded` is false until the first successful read, and again after
 * a dep change — for callers that must tell "not there" from "not read yet".
 */
export function usePolled<T>(
  load: (() => Promise<T>) | null,
  initial: T,
  everyMs: number,
  deps: DependencyList,
  keepPrevious = false,
): { value: T; reload: () => void; loaded: boolean } {
  return useAsyncValue(load, initial, everyMs, deps, keepPrevious)
}
