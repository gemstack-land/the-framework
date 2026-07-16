import type { FrameworkEvent } from '@gemstack/framework'
import { EventList } from './EventList.js'
import { RunOverview } from './RunOverview.js'

// One run's feed: the run overview plus the live/replayed event log, or a waiting placeholder
// before anything has streamed. Shared by the run's own view (RunLive, with its Stop control)
// and the read-only relay watch view (RelayView).
export function RunFeed({ events }: { events: FrameworkEvent[] }) {
  if (events.length === 0) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Waiting for the run to start…</div>
  }
  return (
    <>
      <RunOverview events={events} />
      <EventList events={events} />
    </>
  )
}
