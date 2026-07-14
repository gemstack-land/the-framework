import type { FrameworkEvent } from '@gemstack/framework'
import { sendStop } from '../server/control.telefunc.js'
import { isRunActive } from '../lib/live-state.js'
import { EventList } from './EventList.js'
import { StartRunForm } from './StartRunForm.js'
import { PreviewBar } from './PreviewBar.js'
import { RunOverview } from './RunOverview.js'
import { Button } from './ui/button.js'

// The live event view (#405/#314): a projection of the selected project's
// `.the-framework/events.jsonl`, streamed over a Telefunc Channel by the shell's
// `useLiveEvents` hook and passed in as `events`. The main column shows the run overview,
// the event feed, and the Stop/Start controls; the interactive choice gates the run parks
// on now live in the right rail (#440), read from this same stream.
export function EventStream({
  projectId,
  events,
  readOnly = false,
  onRunStarted,
}: {
  projectId: string | null
  events: FrameworkEvent[]
  readOnly?: boolean
  onRunStarted?: (intent: string) => void
}) {
  if (!projectId) {
    return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Select a project to watch its live run.</div>
  }

  // Read-only watch mode (the relay, #426): no steering (no Stop/Start), just the run
  // overview + the live event feed, both projected from the stream.
  if (readOnly) {
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

  const active = isRunActive(events)
  return (
    <>
      <PreviewBar projectId={projectId} />
      {active ? (
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button variant="outline" size="sm" onClick={() => void sendStop(projectId)}>
            Stop run
          </Button>
        </div>
      ) : (
        <StartRunForm projectId={projectId} onRunStarted={onRunStarted} />
      )}
      {events.length > 0 ? (
        <>
          <RunOverview events={events} />
          <EventList events={events} />
        </>
      ) : (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">No events yet.</div>
      )}
    </>
  )
}
