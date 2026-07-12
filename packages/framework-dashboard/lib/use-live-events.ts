import { useEffect, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import type { ClientChannel } from 'telefunc'
import { onEvents } from '../server/events.telefunc.js'

// The live run feed (#405), shared. The dashboard is a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over a Telefunc Channel that pushes one
// `FrameworkEvent` per new line. Both the main event view and the right rail's choice gates
// (#440) read this same stream, so the subscription lives here and each consumer owns one
// channel for its project rather than opening a second.
export function useLiveEvents(projectId: string | null): FrameworkEvent[] {
  const [events, setEvents] = useState<FrameworkEvent[]>([])

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

  return events
}
