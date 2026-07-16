import { useEffect, useRef } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { formatFrameworkEvent } from '@gemstack/framework/client'
import { Badge } from './ui/badge.js'

// Presentational event log, shared by the live stream and past-run replay. Each
// FrameworkEvent is a kind badge + its human-readable line (the same formatter the
// terminal uses, so a `driver` turn reads "· Read" / "‹ turn complete" rather than raw
// JSON); the pane sticks to the bottom as events arrive (live), replay renders at once.
// The prompt-disclosure surface (#476/#520): the full text rides on the event, but the
// one-line formatter reduces it to a char count (a driver `start`'s prompt) or drops it (a
// system prompt). So the "see every prompt without a script" block renders it here; every
// other event renders as its formatted line. Returns null for the non-disclosable events.
function disclosableText(e: FrameworkEvent): { text: string; label: string } | null {
  if (e.kind === 'system-prompt') return { text: e.text, label: 'system prompt sent' }
  if (e.kind === 'driver' && e.event.type === 'start') return { text: e.event.prompt, label: '› prompt sent' }
  return null
}

export function EventList({ events, stick = true }: { events: FrameworkEvent[]; stick?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stick) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, stick])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ol className="space-y-1 font-mono text-xs">
        {events.map((e, i) => {
          const disclosable = disclosableText(e)
          return (
            <li key={i} className="flex items-start gap-2">
              <Badge className="mt-0.5 shrink-0 text-[10px] uppercase text-muted-foreground">{e.kind}</Badge>
              {disclosable ? (
                <details className="min-w-0 flex-1">
                  <summary className="cursor-pointer text-foreground marker:text-muted-foreground">
                    {disclosable.label} ({disclosable.text.length.toLocaleString()} chars) — click to expand
                  </summary>
                  <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground">{disclosable.text}</pre>
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
