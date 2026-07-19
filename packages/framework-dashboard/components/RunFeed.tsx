import type { FrameworkEvent } from '@gemstack/framework'
import { EventList } from './EventList.js'
import { RunOverview } from './RunOverview.js'

// One run's feed: the run overview plus the live/replayed event log, or a waiting placeholder
// before anything has streamed. Shared by the run's own view (RunLive, which shows the session
// link in its action bar instead — `showSessionLink={false}`) and the read-only relay watch view
// (RelayView, which keeps it since it has no action bar).
export function RunFeed({ events, showSessionLink = true }: { events: FrameworkEvent[]; showSessionLink?: boolean }) {
  if (events.length === 0) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Waiting for the session to start…</div>
  }
  return (
    <>
      <RunOverview events={events} showSessionLink={showSessionLink} />
      <EventList events={events} />
    </>
  )
}
