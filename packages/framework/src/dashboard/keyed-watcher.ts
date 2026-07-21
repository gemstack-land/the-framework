import type { ProjectSummary } from './projects.js'

// The daemon-side half of notifications (#627): a background poll of a projection over the
// registered projects that fires even when no dashboard is open — that is what a Discord
// message buys over the browser notification. One engine, two callers: the "needs you" queue
// (#627) and the "New activity" feed. They differ only in what they project and how an item
// is identified, so those are parameters rather than a second copy of the poll.

/**
 * Tracks which items have been announced, so only new ones notify. Identity is the caller's
 * (`keyOf`), since what makes two items "the same" is a property of what is being watched.
 * Testable without timers.
 */
export class SeenTracker<T> {
  private readonly seen = new Set<string>()
  private warmedUp = false

  constructor(private readonly keyOf: (item: T) => string) {}

  /**
   * Fold a poll's items into the baseline and return the ones not seen before. The first call
   * only establishes the baseline (returns `[]`), so whatever already existed at start-up is
   * never announced — you only hear about what happens while the daemon is watching.
   */
  observe(items: T[]): T[] {
    const fresh = this.warmedUp ? items.filter(item => !this.seen.has(this.keyOf(item))) : []
    for (const item of items) this.seen.add(this.keyOf(item))
    this.warmedUp = true
    return fresh
  }
}

/** A running watcher; call {@link KeyedWatcher.stop} to end it. */
export interface KeyedWatcher {
  stop: () => void
  /** Run one poll now. Exposed so the daemon and tests can drive it deterministically. */
  poll: () => Promise<void>
}

/** Options for {@link startKeyedWatcher}. */
export interface KeyedWatcherOptions<T> {
  /** The projects to scan each poll (the daemon passes the registry, mapped to summaries). */
  projects: () => Promise<ProjectSummary[]>
  /** Project the scanned projects into the items being watched. */
  build: (projects: ProjectSummary[]) => Promise<T[]>
  /** The stable identity of an item, so the same one is only ever announced once. */
  keyOf: (item: T) => string
  /** Called with the genuinely-new items each poll (empty polls are skipped). */
  onNew: (items: T[]) => void | Promise<void>
  /** Poll cadence, ms. Default 60s — the watched things change slowly and a poll can spawn `gh` per project. */
  intervalMs?: number
}

/**
 * Start polling a projection and hand each poll's new items to `onNew`. The first poll only
 * seeds the baseline. Forgiving — a failed project scan or projection just yields no new items
 * that cycle. Runs immediately, then every `intervalMs`; the timer is unref'd so it never keeps
 * the daemon alive past shutdown.
 */
export function startKeyedWatcher<T>(opts: KeyedWatcherOptions<T>): KeyedWatcher {
  const tracker = new SeenTracker(opts.keyOf)
  let stopped = false
  let running = false

  const poll = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      const projects = await opts.projects().catch(() => [])
      const items = await opts.build(projects).catch(() => [])
      const fresh = tracker.observe(items)
      if (fresh.length > 0 && !stopped) await opts.onNew(fresh)
    } finally {
      running = false
    }
  }

  void poll()
  const timer = setInterval(() => void poll(), opts.intervalMs ?? 60_000)
  timer.unref?.()
  return {
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
    poll,
  }
}
