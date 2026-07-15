import { useEffect, useState } from 'react'
import type { QuotaView } from '@gemstack/framework'
import { onQuota } from '../server/quota.telefunc.js'

// The usage panel's data (#535). The daemon polls the agent for us and caches the answer,
// so this only has to ask the daemon for what it already knows — cheap, unlike the read
// behind it. Prerender has no daemon, so it starts empty and loads on the client.

/** How often to ask the daemon for its cached reading. Cheap: no agent is spawned. */
const REFRESH_MS = 30_000

/**
 * The account's quota and where the limits stand, refreshed while the panel is open.
 *
 * `undefined` until the first answer arrives. A failed call keeps the last view rather
 * than blanking it: an empty bar reads as "nothing used".
 */
export function useQuota(): QuotaView | undefined {
  const [view, setView] = useState<QuotaView | undefined>(undefined)

  useEffect(() => {
    let live = true
    const load = (): void => {
      void onQuota()
        .then(next => {
          if (live) setView(next)
        })
        .catch(() => {
          // Keep whatever we last showed; the next tick may well succeed.
        })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [])

  return view
}
