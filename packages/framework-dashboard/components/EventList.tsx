import type { FrameworkEvent } from '@gemstack/framework'
import { formatFrameworkEvent } from '@gemstack/framework/client'
import { receivedAt } from '../lib/event-times.js'
import { Badge } from './ui/badge.js'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './ui/message-scroller.js'

// Presentational event log, shared by the live stream and past-run replay. Each
// FrameworkEvent renders as its human-readable line (the same formatter the terminal
// uses, so a `driver` turn reads "· Read" / "‹ turn complete" rather than raw JSON),
// with the kind badge shown once per run of same-kind lines — a 200-line driver turn
// used to be 200 identical "DRIVER" badges (#948). Live rows carry their arrival time
// at each kind boundary; replayed events were never live, so they show none.
// Scrolling rides shadcn's Base UI message-scroller (#712): live follows the edge
// (`autoScroll`) but yields the moment the reader scrolls up, replay renders static from the
// top, and the "Jump to latest" chip is the scroller's own inert-when-not-scrollable button —
// replacing the hand-rolled U19 stick/jump logic.
// The prompt-disclosure surface (#476/#520): the full text rides on the event, but the
// one-line formatter reduces it to a char count (a driver `start`'s prompt) or drops it (a
// system prompt). So the "see every prompt without a script" block renders it here; every
// other event renders as its formatted line. Returns null for the non-disclosable events.
function disclosableText(e: FrameworkEvent): { text: string; label: string } | null {
  if (e.kind === 'system-prompt') return { text: e.text, label: 'system prompt sent' }
  if (e.kind === 'driver' && e.event.type === 'start') return { text: e.event.prompt, label: '› prompt sent' }
  return null
}

// A driver `start` opens a fresh prompt turn — the natural anchor the scroller keeps in view.
function isTurnBoundary(e: FrameworkEvent): boolean {
  return e.kind === 'driver' && e.event.type === 'start'
}

/** HH:MM:SS in the reader's locale, for the arrival-time column. */
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}

export function EventList({ events, stick = true }: { events: FrameworkEvent[]; stick?: boolean }) {
  return (
    <MessageScrollerProvider autoScroll={stick} defaultScrollPosition={stick ? 'end' : 'start'}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Session output">
          <MessageScrollerContent className="gap-1 p-4 font-mono text-xs">
            {events.map((e, i) => {
              const disclosable = disclosableText(e)
              const chunkHead = i === 0 || events[i - 1]?.kind !== e.kind
              const at = receivedAt(e)
              return (
                <MessageScrollerItem key={i} messageId={String(i)} scrollAnchor={isTurnBoundary(e)} className="flex items-start gap-2">
                  {/* Fixed-width badge column so the text lines up whether or not this row repeats the kind. */}
                  <span className="w-20 shrink-0">
                    {chunkHead && <Badge className="mt-0.5 text-[10px] uppercase text-muted-foreground">{e.kind}</Badge>}
                  </span>
                  {disclosable ? (
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-foreground marker:text-muted-foreground">
                        {disclosable.label} ({disclosable.text.length.toLocaleString()} chars) — click to expand
                      </summary>
                      <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-foreground">{disclosable.text}</pre>
                    </details>
                  ) : (
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">{(formatFrameworkEvent(e) ?? '').trim()}</span>
                  )}
                  {chunkHead && at !== undefined && (
                    <span className="ml-auto shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground" title={new Date(at).toLocaleString()}>
                      {formatTime(at)}
                    </span>
                  )}
                </MessageScrollerItem>
              )
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
