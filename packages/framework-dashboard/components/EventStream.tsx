import { useEffect, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { EventList } from './EventList.js'

// The live event stream (#406/#314): a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over SSE (server/events-sse.ts). The row
// rendering is shared with run replay via EventList.
export function EventStream({ projectId }: { projectId: string | null }) {
  const [events, setEvents] = useState<FrameworkEvent[]>([])

  useEffect(() => {
    setEvents([])
    if (!projectId) return
    const source = new EventSource(`/api/events?project=${encodeURIComponent(projectId)}`)
    source.onmessage = e => {
      try {
        setEvents(prev => [...prev, JSON.parse(e.data) as FrameworkEvent])
      } catch {
        // a malformed line never crashes the stream
      }
    }
    return () => source.close()
  }, [projectId])

  if (!projectId) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Select a project to watch its live run.</div>
  }
  if (events.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
        Waiting for events… (start a run in this project)
      </div>
    )
  }
  return <EventList events={events} />
}
