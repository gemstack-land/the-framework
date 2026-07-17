import type { ProjectSummary } from './projects.js'
import { buildActivity, activityKey, pickNewActivity, type Activity } from './activity.js'

// The daemon-side half of "New activity" notifications (#627): a background poll of the activity
// feed that fires even when no dashboard is open — the same thing the interventions watcher does
// for the "needs you" queue, for the default-off activity category. It mirrors intervention-watcher.ts
// deliberately (a separate, self-contained watcher rather than a shared generic) so the two notifier
// paths stay independently readable; both use the "only genuinely new, with a start-up baseline" rule.

/** Tracks which activity items have been announced, so only new transitions notify. Testable without timers. */
export class ActivityTracker {
  private readonly seen = new Set<string>()
  private warmedUp = false

  /**
   * Fold a poll's items into the baseline and return the ones not seen before. The first call only
   * establishes the baseline (returns `[]`), so the runs already going/finished at start-up are
   * never announced — you only hear about transitions that happen while the daemon is watching.
   */
  observe(items: Activity[]): Activity[] {
    const fresh = this.warmedUp ? pickNewActivity(this.seen, items) : []
    for (const item of items) this.seen.add(activityKey(item))
    this.warmedUp = true
    return fresh
  }
}

/** How one activity item reads on Discord: a started run, or a finished one tagged by its outcome. */
function line(item: Activity): string {
  const what = item.title ?? 'a run'
  if (item.kind === 'started') return `▶️ started: ${what}`
  const mark = item.status === 'failed' ? '❌' : item.status === 'stopped' ? '⏹️' : '✅'
  return `${mark} finished: ${what}`
}

/** Post the given activity items to a Discord webhook as one message. `fetch` is injectable for tests. */
export async function postActivityDiscord(
  webhook: string,
  items: Activity[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (items.length === 0) return
  const content =
    items.length === 1
      ? `📣 Activity (${items[0]!.projectName}): ${line(items[0]!)}`
      : `📣 ${items.length} run updates:\n${items.map(i => `• ${i.projectName}: ${line(i)}`).join('\n')}`
  await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

/** A running watcher; call {@link ActivityWatcher.stop} to end it. */
export interface ActivityWatcher {
  stop: () => void
  /** Run one poll now. Exposed so the daemon and tests can drive it deterministically. */
  poll: () => Promise<void>
}

/** Options for {@link startActivityWatcher}. */
export interface ActivityWatcherOptions {
  /** The projects to scan each poll (the daemon passes the registry, mapped to summaries). */
  projects: () => Promise<ProjectSummary[]>
  /** Called with the genuinely-new activity each poll (empty polls are skipped). */
  onNew: (items: Activity[]) => void | Promise<void>
  /** Poll cadence, ms. Default 60s. */
  intervalMs?: number
  /** Override the projection (tests). */
  build?: (projects: ProjectSummary[]) => Promise<Activity[]>
}

/**
 * Start polling the activity feed and hand each poll's new transitions to `onNew`. The first poll
 * only seeds the baseline. Forgiving — a failed project scan or projection just yields no new items
 * that cycle. Runs immediately, then every `intervalMs`; the timer is unref'd so it never keeps the
 * daemon alive past shutdown.
 */
export function startActivityWatcher(opts: ActivityWatcherOptions): ActivityWatcher {
  const build = opts.build ?? buildActivity
  const tracker = new ActivityTracker()
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
