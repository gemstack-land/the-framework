import { contextQuota } from './context.js'
import { DEFAULT_CONSUMPTION_LIMITS, consumptionStatus, ConsumptionMeter } from '../consumption.js'
import type { QuotaView } from '../dashboard/quota.js'

// The usage panel's read surface (#533): where the account's subscription quota stands,
// and where the user's consumption limits (#519) stand against it. The source is threaded
// through the Telefunc request context by the daemon, which polls for its whole life; a
// public host (the relay) leaves it unwired, so the panel reports it has no reading rather
// than an empty one.

/** An honest empty view: no reading, and no limit measurable against one. */
function noReading(): QuotaView {
  // Measured off an empty meter rather than filled with zeroes: an empty bar
  // reads as "nothing used", which is the one thing this panel must never imply,
  // so `consumed` / `usedPercent` stay undefined and the UI can say so.
  return {
    windows: [],
    unavailable: 'fetch-failed',
    limits: consumptionStatus({ meter: new ConsumptionMeter(), limits: DEFAULT_CONSUMPTION_LIMITS }),
  }
}

/** Where the account's quota and the user's limits stand. */
export async function onQuota(): Promise<QuotaView> {
  const source = contextQuota()
  if (!source) return noReading()
  return source.read().catch(() => noReading())
}
