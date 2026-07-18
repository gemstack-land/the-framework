import { useEffect, useMemo, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import type { ClientChannel } from 'telefunc'
import { onEvents } from '../server/events.telefunc.js'
import { currentRunEvents } from './live-state.js'

// The live run feed (#405), shared. The dashboard is a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over a Telefunc Channel that pushes one
// `FrameworkEvent` per new line. Both the main event view and the right rail's choice gates
// (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel for its project rather than opening a second.
export function useLiveEvents(projectId: string | null, resetKey?: unknown): FrameworkEvent[] {
  const [events, setEvents] = useState<FrameworkEvent[]>([])

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
    if (!projectId) return
    let channel: ClientChannel<never, FrameworkEvent> | undefined
    let cancelled = false
    void onEvents(projectId).then(ch => {
      if (cancelled) {
        void ch.close()
        return
      }
      channel = ch
      ch.listen(event => setEvents(prev => [...prev, event]))
    })
    return () => {
      cancelled = true
      void channel?.close()
    }
  }, [projectId])

  // Scope the accumulated feed to the run in progress. The subscription lives across run
  // boundaries (it only resets on a project switch), so without this a second run would show
  // the previous run's log until it finished. See {@link currentRunEvents}.
  return useMemo(() => currentRunEvents(events), [events])
}
