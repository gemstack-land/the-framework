import type { FrameworkEvent } from '@gemstack/framework'
import { formatFrameworkEvent } from '@gemstack/framework/client'
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
// FrameworkEvent is a kind badge + its human-readable line (the same formatter the
// terminal uses, so a `driver` turn reads "· Read" / "‹ turn complete" rather than raw
// JSON). Scrolling rides shadcn's Base UI message-scroller (#712): live follows the edge
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

export function EventList({ events, stick = true }: { events: FrameworkEvent[]; stick?: boolean }) {
  return (
    <MessageScrollerProvider autoScroll={stick} defaultScrollPosition={stick ? 'end' : 'start'}>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport aria-label="Run output">
          <MessageScrollerContent className="gap-1 p-4 font-mono text-xs">
            {events.map((e, i) => {
              const disclosable = disclosableText(e)
              return (
                <MessageScrollerItem key={i} messageId={String(i)} scrollAnchor={isTurnBoundary(e)} className="flex items-start gap-2">
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
