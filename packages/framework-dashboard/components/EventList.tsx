import { useEffect, useRef } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { Badge } from './ui/badge.js'

// Presentational event log, shared by the live SSE stream and past-run replay. Each
// FrameworkEvent is a kind badge + a one-line summary; the pane sticks to the bottom
// as events arrive (live) — replay renders the whole list at once.
export function EventList({ events, stick = true }: { events: FrameworkEvent[]; stick?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stick) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, stick])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ol className="space-y-1 font-mono text-xs">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            <Badge className="mt-0.5 shrink-0 text-[10px] uppercase text-muted-foreground">{e.kind}</Badge>
            <span className="whitespace-pre-wrap break-words text-foreground">{summarizeEvent(e)}</span>
          </li>
        ))}
      </ol>
      <div ref={bottomRef} />
    </div>
  )
}

/** A one-line human summary of an event: its message when it has one, else compact JSON. */
export function summarizeEvent(event: FrameworkEvent): string {
  const record = event as Record<string, unknown>
  if (typeof record['message'] === 'string') return record['message']
  if (typeof record['title'] === 'string') return record['title']
  const { kind, ...rest } = record
  return Object.keys(rest).length ? JSON.stringify(rest) : String(kind)
}
