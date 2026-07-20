import { consumptionStatus, DEFAULT_CONSUMPTION_LIMITS, type ConsumptionLimits, type ConsumptionStatus } from '../consumption.js'
import { QuotaPoller } from '../quota-poller.js'
import { ClaudeCodeDriver, type DriverQuotaUnavailableReason, type DriverQuotaWindow } from '../driver/index.js'
import { readPreferences, resolveConsumptionLimits } from '../registry.js'

/**
 * Everything the dashboard needs to draw the usage panel (#533): the account's
 * own windows, and where the user's limits stand against them.
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
  /** Where the three limits stand, for their checkboxes and bars. */
  limits: ConsumptionStatus
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
 * The limits are re-read per call rather than captured, so a user who changes
 * them in the settings sees the bars re-scale without a restart.
 */
export function pollerQuotaSource(poller: QuotaPoller, limits: () => Promise<ConsumptionLimits>): QuotaSource {
  return {
    stop: () => poller.stop(),
    read: async () => {
      const envelope = poller.current()
      const windows = envelope.lastGood?.windows ?? []
      // The account's own week, handed to the limits so the weekly one is measured against it
      // rather than against the delta meter (#876).
      const accountWeek = windows.find(w => w.kind === 'week')?.percentUsed
      const view: QuotaView = {
        windows,
        limits: consumptionStatus({
          meter: poller.meter,
          limits: await limits().catch(() => DEFAULT_CONSUMPTION_LIMITS),
          ...(accountWeek !== undefined ? { accountWeekPercent: accountWeek } : {}),
        }),
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
export function defaultQuotaSource(): QuotaSource {
  const driver = new ClaudeCodeDriver()
  const poller = new QuotaPoller({ read: () => driver.readQuota() })
  poller.start()
  return pollerQuotaSource(poller, async () => resolveConsumptionLimits(await readPreferences()))
}
