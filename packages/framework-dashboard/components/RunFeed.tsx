import type { FrameworkEvent } from '@gemstack/framework'
import { TriangleAlert } from 'lucide-react'
import { EventList } from './EventList.js'
import { RunOverview } from './RunOverview.js'

// One run's feed: the run overview plus the live/replayed event log, or a waiting placeholder
// before anything has streamed. Shared by the run's own view (RunLive, which shows the session
// link in its action bar instead — `showSessionLink={false}`) and the read-only relay watch view
// (RelayView, which keeps it since it has no action bar). `lost` is the live channel's health
// (#948): while the stream is down the feed is behind reality, and saying so beats letting
// "the agent went quiet" and "the connection died" look identical.
export function RunFeed({
  events,
  showSessionLink = true,
  lost = false,
}: {
  events: FrameworkEvent[]
  showSessionLink?: boolean
  lost?: boolean
}) {
  const lostBanner = lost && (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Live stream lost — reconnecting. The session keeps running; this view may be behind.
    </div>
  )
  if (events.length === 0) {
    return (
      <>
        {lostBanner}
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Waiting for the session to start…</div>
      </>
    )
  }
  return (
    <>
      {lostBanner}
      <RunOverview events={events} showSessionLink={showSessionLink} />
      <EventList events={events} />
    </>
  )
}
