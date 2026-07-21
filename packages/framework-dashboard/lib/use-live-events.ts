import { useEffect, useMemo, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import type { ClientChannel } from 'telefunc'
import { onEvents } from '../server/events.telefunc.js'
import { currentRunEvents } from './live-state.js'
import { stampReceived } from './event-times.js'

// The live run feed (#405), shared. The dashboard is a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over a Telefunc Channel that pushes one
// `FrameworkEvent` per new line. Both the main event view and the right rail's choice gates
// (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel rather than opening a second.
//
// The feed is per RUN, not per project (#749): each run tails its own worktree's log since #736,
// so the selected run id picks the log to follow. Changing it resubscribes, which is what makes
// selecting run A vs run B show different output. Omitted (the relay, or a Start whose id has not
// been adopted yet) falls back to the project root.

/** The live feed plus whether its channel is currently down (#948). */
export interface LiveEvents {
  events: FrameworkEvent[]
  /** True while the stream is lost and being retried — the feed may be behind reality. */
  lost: boolean
  /** The server closed the channel on purpose (relay stream ended, unknown run) — final. */
  done: boolean
}

/** Retry delays for a lost stream: quick first, then settle at a slow poll. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] as number
}

export function useLiveEvents(projectId: string | null, runId?: string | null, resetKey?: unknown): LiveEvents {
  const [events, setEvents] = useState<FrameworkEvent[]>([])
  const [lost, setLost] = useState(false)
  const [done, setDone] = useState(false)

  // Drop the accumulated feed at a run boundary the caller knows about (a fresh Start bumps
  // `resetKey`), WITHOUT tearing down the subscription. The new run truncates events.jsonl a
  // beat later, so until its first line streams the buffer would otherwise still hold the
  // finished run — which the jump-to-live view (#705) would show. Clearing here means the pane
  // waits empty for the new run instead. The live tail then re-reads the truncated file on its
  // own (JsonlTailer rewrite detection) and streams the new run in.
  useEffect(() => {
    setEvents([])
  }, [resetKey])

  useEffect(() => {
    setEvents([])
    setLost(false)
    setDone(false)
    if (!projectId) return
    let channel: ClientChannel<never, FrameworkEvent> | undefined
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    // A dead stream used to be silent: the daemon restarts, events just stop, and "the agent
    // went quiet" is indistinguishable from "the feed died" (#948). Now an errored close (or a
    // failed subscribe) flips `lost` and retries with backoff. A clean close is the server being
    // done with the channel on purpose (relay stream ended, unknown project) — not an outage —
    // so it neither retries nor alarms, matching the old behavior.
    const retry = () => {
      if (cancelled) return
      setLost(true)
      timer = setTimeout(subscribe, retryDelay(attempt++))
    }

    const subscribe = () => {
      void onEvents(projectId, runId ?? undefined).then(ch => {
        if (cancelled) {
          void ch.close()
          return
        }
        channel = ch
        attempt = 0
        setLost(false)
        // The tail replays the whole log on subscribe, so a reconnect starts from an empty
        // buffer rather than appending a duplicate history.
        setEvents([])
        ch.listen(event => {
          stampReceived(event)
          setEvents(prev => [...prev, event])
        })
        ch.onClose(err => {
          if (err) retry()
          else if (!cancelled) setDone(true)
        })
      }, retry)
    }

    subscribe()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      void channel?.close()
    }
    // runId is a dependency: selecting another run must resubscribe to that run's log (#749).
  }, [projectId, runId])

  // Scope the accumulated feed to the run in progress. The subscription lives across run
  // boundaries (it only resets on a project switch), so without this a second run would show
  // the previous run's log until it finished. See {@link currentRunEvents}.
  const scoped = useMemo(() => currentRunEvents(events), [events])
  return { events: scoped, lost, done }
}
