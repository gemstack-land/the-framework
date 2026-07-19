import { useEffect, useMemo, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import type { ClientChannel } from 'telefunc'
import { onEvents } from '../server/events.telefunc.js'
import { currentRunEvents } from './live-state.js'

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
export function useLiveEvents(projectId: string | null, runId?: string | null, resetKey?: unknown): FrameworkEvent[] {
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
    void onEvents(projectId, runId ?? undefined).then(ch => {
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
    // runId is a dependency: selecting another run must resubscribe to that run's log (#749).
  }, [projectId, runId])

  // Scope the accumulated feed to the run in progress. The subscription lives across run
  // boundaries (it only resets on a project switch), so without this a second run would show
  // the previous run's log until it finished. See {@link currentRunEvents}.
  return useMemo(() => currentRunEvents(events), [events])
}
