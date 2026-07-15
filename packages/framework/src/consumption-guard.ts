import { consumptionStatus, type ConsumptionLimits, type ConsumptionWindow } from './consumption.js'
import { QuotaPoller } from './quota-poller.js'
import type { Driver } from './driver/index.js'

/** A live consumption gate, and the polling behind it. */
export interface ConsumptionGuard {
  /**
   * Pass as `consumptionGate` to a run. Answers from the poller's cached
   * readings, so it is cheap enough to ask between every turn.
   */
  gate: () => ConsumptionWindow | null
  /** The poller feeding it, exposed so a caller can read the bars off it. */
  poller: QuotaPoller
  /** Stop polling. Always call this when the run ends. */
  stop: () => void
}

/** Options for {@link startConsumptionGuard}. */
export interface StartConsumptionGuardOptions {
  /** The wrapped agent. Must be able to report its quota, or there's nothing to guard with. */
  driver: Driver
  /** The limits in force. Get them with `resolveConsumptionLimits(await readPreferences())`. */
  limits: ConsumptionLimits
  /** When the run started, epoch ms. Default now. */
  sessionStartedAt?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

/**
 * Wire the consumption limits up for one run (#531): poll the agent's quota, and
 * hand back the gate a run consults between turns.
 *
 * Resolves `undefined` when there is nothing to guard with — the agent can't
 * report a quota at all (the fake driver, or a second agent that has no such
 * command). That is the fail-open Rom confirmed on #519: no reading means the
 * work carries on, with the per-run budget cap still underneath it.
 *
 * The first read is deliberately not awaited. It takes ~5s (it spawns the whole
 * agent CLI), and making every run wait that long to *maybe* find out it has
 * budget would be a poor trade. It lands a moment into the run instead, so the
 * session's own measurement starts from there.
 */
export function startConsumptionGuard(opts: StartConsumptionGuardOptions): ConsumptionGuard | undefined {
  const readQuota = opts.driver.readQuota?.bind(opts.driver)
  if (!readQuota) return undefined

  const now = opts.now ?? (() => Date.now())
  const sessionStartedAt = opts.sessionStartedAt ?? now()
  const poller = new QuotaPoller({ read: () => readQuota(), now })
  poller.start()

  return {
    poller,
    stop: () => poller.stop(),
    gate: () =>
      consumptionStatus({
        meter: poller.meter,
        limits: opts.limits,
        sessionStartedAt,
        now: now(),
      }).reached,
  }
}
