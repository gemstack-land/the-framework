import { QuotaPoller } from './quota-poller.js'
import { quotaBoundaryStatus } from './quota-boundary.js'
import type { Driver } from './driver/index.js'

/** A live quota gate, and the polling behind it. */
export interface ConsumptionGuard {
  /**
   * Pass as `consumptionGate` to a run. Answers from the poller's cached
   * readings, so it is cheap enough to ask between every turn. The label of the
   * window that reached the boundary, or null while there is room.
   */
  gate: () => string | null
  /** The poller feeding it, exposed so a caller can read the windows off it. */
  poller: QuotaPoller
  /** Stop polling. Always call this when the run ends. */
  stop: () => void
}

/** Options for {@link startConsumptionGuard}. */
export interface StartConsumptionGuardOptions {
  /** The wrapped agent. Must be able to report its quota, or there's nothing to guard with. */
  driver: Driver
  /** The model the run is on. Brings that model's own weekly window into the gate (#879). */
  model?: string
  /** Clock, injectable for tests. */
  now?: () => number
}

/**
 * Wire the quota boundary up for one run (#879): poll the agent's quota, and
 * hand back the gate a run consults between turns.
 *
 * The boundary is derived from the account's own week, so there is nothing to
 * configure and nothing to remember between restarts: it is a comparison of two
 * numbers the agent reports, not a total we accumulate.
 *
 * Resolves `undefined` when there is nothing to guard with — the agent can't
 * report a quota at all (the fake driver, or a second agent that has no such
 * command). That is the fail-open Rom confirmed on #519: no reading means the
 * work carries on, with the per-run budget cap still underneath it. The gate
 * itself fails open for the same reason, which is the opposite of the auto-PM
 * gate: this one guards work the user asked for.
 *
 * The first read is deliberately not awaited. It takes ~5s (it spawns the whole
 * agent CLI), and making every run wait that long to *maybe* find out it has
 * budget would be a poor trade. It lands a moment into the run instead.
 */
export function startConsumptionGuard(opts: StartConsumptionGuardOptions): ConsumptionGuard | undefined {
  const readQuota = opts.driver.readQuota?.bind(opts.driver)
  if (!readQuota) return undefined

  const now = opts.now ?? (() => Date.now())
  const poller = new QuotaPoller({ read: () => readQuota(), now })
  poller.start()

  return {
    poller,
    stop: () => poller.stop(),
    gate: () => {
      const windows = poller.current().lastGood?.windows
      if (!windows) return null
      const status = quotaBoundaryStatus({ windows, now: now(), ...(opts.model ? { model: opts.model } : {}) })
      return status?.reached?.label ?? null
    },
  }
}
