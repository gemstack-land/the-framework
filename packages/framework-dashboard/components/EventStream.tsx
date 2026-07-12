import { useEffect, useRef, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { Badge } from './ui/badge.js'

// The live event stream (#406/#314): a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over SSE (server/events-sse.ts). Each
// FrameworkEvent renders as a kind badge + a one-line summary; the pane sticks to the
// bottom as new events land, like a run log.
export function EventStream({ projectId }: { projectId: string | null }) {
  const [events, setEvents] = useState<FrameworkEvent[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  if (!projectId) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Select a project to watch its live run.</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {events.length === 0 && (
        <p className="text-sm text-muted-foreground">Waiting for events… (start a run in this project)</p>
      )}
      <ol className="space-y-1 font-mono text-xs">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            <Badge className="mt-0.5 shrink-0 text-[10px] uppercase text-muted-foreground">{e.kind}</Badge>
            <span className="whitespace-pre-wrap break-words text-foreground">{summarize(e)}</span>
          </li>
        ))}
      </ol>
      <div ref={bottomRef} />
    </div>
  )
}

/** A one-line human summary of an event: its message when it has one, else compact JSON. */
function summarize(event: FrameworkEvent): string {
  const record = event as Record<string, unknown>
  if (typeof record['message'] === 'string') return record['message']
  if (typeof record['title'] === 'string') return record['title']
  const { kind, ...rest } = record
  return Object.keys(rest).length ? JSON.stringify(rest) : String(kind)
}
