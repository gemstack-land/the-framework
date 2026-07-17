import type { ProjectSummary } from './projects.js'
import { buildInterventions, interventionKey, pickNewInterventions, type Intervention } from './interventions.js'

// The daemon-side half of notifications (#627): a background poll of the "needs you" queue that
// fires even when no dashboard is open (that is what a Discord message buys over the browser
// notification). Gated on a `DISCORD_WEBHOOK` being set — the env var is the opt-in, per the
// issue. The tracker below is the same "only genuinely new items" rule the browser side uses,
// with a baseline so the PRs already open when the daemon starts do not blast the channel.

/** Tracks which interventions have been announced, so only new ones notify. Testable without timers. */
export class InterventionTracker {
  private readonly seen = new Set<string>()
  private warmedUp = false

  /**
   * Fold a poll's items into the baseline and return the ones not seen before. The first call
   * only establishes the baseline (returns `[]`), so the queue that already existed at start-up
   * is never announced.
   */
  observe(items: Intervention[]): Intervention[] {
    const fresh = this.warmedUp ? pickNewInterventions(this.seen, items) : []
    for (const item of items) this.seen.add(interventionKey(item))
    this.warmedUp = true
    return fresh
  }
}

/** Post the given interventions to a Discord webhook as one message. `fetch` is injectable for tests. */
export async function postDiscord(
  webhook: string,
  items: Intervention[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (items.length === 0) return
  // A PR reads `#123 Title — url`; a paused run (#636) has no number and only the dashboard url,
  // so it reads `Title — awaiting your answer` with the link appended when the daemon knows it.
  const line = (i: Intervention): string =>
    i.kind === 'awaiting'
      ? `${i.title} — awaiting your answer${i.url ? ` — ${i.url}` : ''}`
      : `#${i.number} ${i.title} — ${i.url}`
  const content =
    items.length === 1
      ? `🔔 Needs you (${items[0]!.projectName}): ${line(items[0]!)}`
      : `🔔 ${items.length} items need you:\n${items.map(i => `• ${line(i)}`).join('\n')}`
  await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

/** A running watcher; call {@link InterventionWatcher.stop} to end it. */
export interface InterventionWatcher {
  stop: () => void
  /** Run one poll now. Exposed so the daemon and tests can drive it deterministically. */
  poll: () => Promise<void>
}

/** Options for {@link startInterventionWatcher}. */
export interface InterventionWatcherOptions {
  /** The projects to scan each poll (the daemon passes the registry, mapped to summaries). */
  projects: () => Promise<ProjectSummary[]>
  /** Called with the genuinely-new interventions each poll (empty polls are skipped). */
  onNew: (items: Intervention[]) => void | Promise<void>
  /** Poll cadence, ms. Default 60s — PRs change slowly and each poll spawns `gh` per project. */
  intervalMs?: number
  /** Override the projection (tests). */
  build?: (projects: ProjectSummary[]) => Promise<Intervention[]>
}

/**
 * Start polling the interventions queue and hand each poll's new items to `onNew`. The first
 * poll only seeds the baseline. Forgiving — a failed project scan or projection just yields no
 * new items that cycle. Runs immediately, then every `intervalMs`; the timer is unref'd so it
 * never keeps the daemon alive past shutdown.
 */
export function startInterventionWatcher(opts: InterventionWatcherOptions): InterventionWatcher {
  const build = opts.build ?? buildInterventions
  const tracker = new InterventionTracker()
  let stopped = false
  let running = false

  const poll = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      const projects = await opts.projects().catch(() => [])
      const items = await build(projects).catch(() => [])
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
