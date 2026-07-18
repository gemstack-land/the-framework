import type { FrameworkEvent } from '@gemstack/framework'
import { onRun } from '../server/reads.telefunc.js'
import { EventList } from './EventList.js'
import { RunActionBar } from './RunActionBar.js'
import { useLoaded } from '../lib/use-async.js'

// Replay one archived run: load its event log over a Telefunc RPC and render it in the same
// EventList the live stream uses (no auto-scroll — it is a static log). The action bar rides
// along so Serve + Open session stay put once the run is Done (Stop drops out — it is not active).
export function RunReplay({ projectId, runId }: { projectId: string; runId: string }) {
  // null until the first answer: "Loading run…" and "no events" are different things.
  const events = useLoaded<FrameworkEvent[] | null>(() => onRun(projectId, runId), null, [projectId, runId])

  if (events === null) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading run…</div>
  return (
    <>
      <RunActionBar projectId={projectId} events={events} />
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">This run has no events.</div>
      ) : (
        <EventList events={events} stick={false} />
      )}
    </>
  )
}
