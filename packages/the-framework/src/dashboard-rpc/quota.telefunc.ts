import { contextQuota } from './context.js'
import type { QuotaView } from '../dashboard/quota.js'

// The usage panel's read surface (#533): where the account's subscription quota stands,
// and where it stands against the quota boundary (#879). The source is threaded through
// the Telefunc request context by the daemon, which polls for its whole life; a public
// host (the relay) leaves it unwired, so the panel reports it has no reading rather than
// an empty one.

/** An honest empty view: no reading, and so no boundary to measure against. */
function noReading(): QuotaView {
  // No windows and no boundary rather than zeroes: an empty bar reads as
  // "nothing used", which is the one thing this panel must never imply.
  return { windows: [], unavailable: 'fetch-failed' }
}

/** Where the account's quota stands against its boundary. */
export async function onQuota(): Promise<QuotaView> {
  const source = contextQuota()
  if (!source) return noReading()
  return source.read().catch(() => noReading())
}
