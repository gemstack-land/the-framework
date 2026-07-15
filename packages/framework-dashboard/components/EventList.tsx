import { useEffect, useRef } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { formatFrameworkEvent } from '@gemstack/framework/client'
import { Badge } from './ui/badge.js'

// Presentational event log, shared by the live stream and past-run replay. Each
// FrameworkEvent is a kind badge + its human-readable line (the same formatter the
// terminal uses, so a `driver` turn reads "· Read" / "‹ turn complete" rather than raw
// JSON); the pane sticks to the bottom as events arrive (live), replay renders at once.
export function EventList({ events, stick = true }: { events: FrameworkEvent[]; stick?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stick) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, stick])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ol className="space-y-1 font-mono text-xs">
        {events.map((e, i) => {
          // The exact prompt sent to the agent each turn (#476): it's carried on the
          // driver `start` event but the one-line formatter drops it, so render it
          // here in a collapsible block — the "see every prompt" surface without a script.
          // The run's system prompt (#520) is the same story: the event has carried the
          // full text all along and the formatter reduced it to a char count, so the
          // truth reached the browser and was thrown away. Same block, same shape.
          const turnPrompt = e.kind === 'driver' && e.event.type === 'start' ? e.event.prompt : undefined
          const prompt = e.kind === 'system-prompt' ? e.text : turnPrompt
          const label = e.kind === 'system-prompt' ? 'system prompt sent' : '› prompt sent'
          return (
            <li key={i} className="flex items-start gap-2">
              <Badge className="mt-0.5 shrink-0 text-[10px] uppercase text-muted-foreground">{e.kind}</Badge>
              {prompt !== undefined ? (
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer text-foreground marker:text-muted-foreground">
                    {label} ({prompt.length.toLocaleString()} chars) — click to expand
                  </summary>
                  <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground">{prompt}</pre>
                </details>
              ) : (
                <span className="whitespace-pre-wrap break-words text-foreground">{(formatFrameworkEvent(e) ?? '').trim()}</span>
              )}
            </li>
          )
        })}
      </ol>
      <div ref={bottomRef} />
    </div>
  )
}
