import type { FrameworkEvent } from '@gemstack/framework'
import { sessionInfo } from '@gemstack/framework/client'
import { onRun } from '../server/reads.telefunc.js'
import { EventList } from './EventList.js'
import { RunActionBar } from './RunActionBar.js'
import { RunResumeChat } from './RunResumeChat.js'
import { useLoaded } from '../lib/use-async.js'

// Replay one archived run: load its event log over a Telefunc RPC and render it in the same
// EventList the live stream uses (no auto-scroll — it is a static log). The action bar rides
// along so Serve + Open session stay put once the run is Done (Stop drops out — it is not active).
// A finished run that captured a session id also gets a composer (#720): sending a message spins a
// fresh run that resumes that conversation, so a stopped/ended run isn't a dead end.
export function RunReplay({
  projectId,
  runId,
  files,
  addContext,
  onRunStarted,
}: {
  projectId: string
  runId: string
  files: string[]
  addContext: (path: string) => void
  onRunStarted: (intent: string) => void
}) {
  // null until the first answer: "Loading run…" and "no events" are different things.
  const events = useLoaded<FrameworkEvent[] | null>(() => onRun(projectId, runId), null, [projectId, runId])

  if (events === null) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading run…</div>
  // The agent session this run ran under (from its `session-update` events): present once the
  // agent reported it, so a run that never got that far simply can't be resumed.
  const sessionId = sessionInfo(events)?.sessionId
  return (
    <>
      <RunActionBar projectId={projectId} events={events} />
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">This run has no events.</div>
      ) : (
        <EventList events={events} stick={false} />
      )}
      {sessionId && (
        <RunResumeChat projectId={projectId} sessionId={sessionId} files={files} addContext={addContext} onRunStarted={onRunStarted} />
      )}
    </>
  )
}
