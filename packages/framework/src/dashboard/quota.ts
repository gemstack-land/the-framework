import { QuotaPoller } from '../quota-poller.js'
import { quotaBoundaryStatus, type QuotaBoundaryStatus } from '../quota-boundary.js'
import { ClaudeCodeDriver, type DriverQuotaUnavailableReason, type DriverQuotaWindow } from '../driver/index.js'
import { readPreferences, type Preferences } from '../registry.js'

/**
 * Everything the dashboard needs to draw the usage panel (#533): the account's
 * own windows, and where they stand against the quota boundary (#879).
 */
export interface QuotaView {
  /**
   * The account's quota windows as the agent reported them (session, week, and
   * a week per model). Empty when we have no reading at all — check
   * {@link unavailable} before reading that as "nothing used".
   */
  windows: DriverQuotaWindow[]
  /** When the reading was taken, epoch ms. Absent when there has never been one. */
  readAt?: number
  /**
   * Why there is no reading, when there isn't one. Present alongside stale
   * `windows` too: the last good reading is kept through a blip, and this says
   * the newest attempt failed, so the UI can mark it stale rather than blank it.
   */
  unavailable?: DriverQuotaUnavailableReason
  /**
   * Where the account stands against its boundary (#879). Absent when there is no
   * reading, or when the week's reset could not be placed — which is "we don't
   * know", not "nothing is allowed".
   */
  boundary?: QuotaBoundaryStatus
}

/** Where a dashboard reads the quota from. */
export interface QuotaSource {
  read(): Promise<QuotaView>
  /** Stop any polling behind it. */
  stop(): void
}

/**
 * A {@link QuotaSource} backed by a live poller.
 *
 * The boundary is computed per call rather than captured: it moves with the
 * clock, so a cached one would be stale the moment the week's day rolls over.
 * No model is passed — the panel is about the account, and a model's own week
 * only narrows the gate for a run that has chosen one (#879).
 */
export function pollerQuotaSource(
  poller: QuotaPoller,
  now: () => number = () => Date.now(),
  /** The user's slider position, read per call so moving it takes effect without a restart (#960). */
  limitOffset: () => number | Promise<number> = () => 0,
): QuotaSource {
  return {
    stop: () => poller.stop(),
    read: async () => {
      const envelope = poller.current()
      const windows = envelope.lastGood?.windows ?? []
      const boundary = quotaBoundaryStatus({ windows, now: now(), limitOffset: await limitOffset() })
      const view: QuotaView = {
        windows,
        ...(boundary ? { boundary } : {}),
        ...(envelope.lastGoodAt !== undefined ? { readAt: envelope.lastGoodAt } : {}),
        ...(envelope.latest && !envelope.latest.available ? { unavailable: envelope.latest.reason } : {}),
      }
      return view
    },
  }
}

/**
 * The daemon's own quota source: it polls for the whole life of the dashboard,
 * not just during a run, because the panel has to show where the account stands
 * even when nothing is running.
 *
 * Separate from the per-run guard on purpose — that one exists to pause a run
 * and dies with it, this one exists to draw a bar.
 */
export function defaultQuotaSource(env: NodeJS.ProcessEnv = process.env): QuotaSource {
  const driver = new ClaudeCodeDriver()
  const poller = new QuotaPoller({ read: () => driver.readQuota() })
  poller.start()
  // One source, so the bar the user reads and the line auto PM obeys cannot disagree (#960): the
  // slider is read here rather than in each consumer. An unreadable registry means the default
  // policy, which is what a fresh install runs anyway.
  return pollerQuotaSource(poller, undefined, async () => {
    const prefs = await readPreferences(undefined, env).catch(() => ({}) as Preferences)
    return prefs.autoSpendOffset ?? 0
  })
}
