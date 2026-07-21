import type { FrameworkEvent } from '@gemstack/framework'
import { runProgress, sessionInfo } from '@gemstack/framework/client'
import { useCallback, useState } from 'react'
import { onRun, onRetainedWorktrees } from '../server/reads.telefunc.js'
import { EventList } from './EventList.js'
import { RunActionBar } from './RunActionBar.js'
import { HandoffActions, HandoffSummary, RunHandoffDetails, handoffExpandable } from './RunHandoff.js'
import { useRunHandoff } from '../lib/use-run-handoff.js'
import { RunResumeChat } from './RunResumeChat.js'
import { useLoaded } from '../lib/use-async.js'
import { runOutcome } from '../lib/live-state.js'

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
  removeContext,
  onRunStarted,
}: {
  projectId: string
  runId: string
  files: string[]
  addContext: (path: string) => void
  removeContext?: ((path: string) => void) | undefined
  onRunStarted: (intent: string) => void
}) {
  // null until the first answer: "Loading session…" and "no events" are different things.
  const events = useLoaded<FrameworkEvent[] | null>(() => onRun(projectId, runId), null, [projectId, runId])
  // Whether this run kept its worktree (#737): a failed/stopped run does, a clean one had it
  // removed when it finished. Drives the Remove button, and is cleared locally once removed so
  // the button goes without waiting for a refetch.
  const retained = useLoaded<string[]>(() => onRetainedWorktrees(projectId), [], [projectId, runId])
  const [removed, setRemoved] = useState(false)
  const hasWorktree = !removed && retained.includes(runId)
  const onWorktreeRemoved = useCallback(() => setRemoved(true), [])
  // What the session's branch holds (#799), read once for both the bar and the detail it opens.
  // Collapsed by default: the summary in the bar answers "did it do anything", and the commit and
  // file lists are the follow-up question, not the first one (#1023).
  const handoff = useRunHandoff(projectId, runId)
  const [openHandoff, setOpenHandoff] = useState(false)
  const canExpand = handoffExpandable(handoff.handoff)

  if (events === null) return <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading session…</div>
  // The agent session this run ran under (from its `session-update` events): present once the
  // agent reported it, so a run that never got that far simply can't be resumed.
  const session = sessionInfo(events)
  const sessionId = session?.sessionId
  // Presets in the resume composer default to this session (#874).
  const sessionName = runProgress(events).sessionName
  return (
    <>
      <RunActionBar
        projectId={projectId}
        runId={runId}
        events={events}
        retainedWorktree={hasWorktree}
        onWorktreeRemoved={onWorktreeRemoved}
        summary={
          <>
            <HandoffSummary handoff={handoff.handoff} />
            {handoff.error && <span className="text-danger">{handoff.error}</span>}
          </>
        }
        expanded={openHandoff}
        {...(canExpand ? { onToggle: () => setOpenHandoff(open => !open) } : {})}
        actions={<HandoffActions projectId={projectId} runId={runId} state={handoff} />}
      />
      {/* The commits and files behind that summary, once asked for. */}
      {openHandoff && <RunHandoffDetails handoff={handoff.handoff} />}
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">This session has no events.</div>
      ) : (
        // Open at the end: the outcome, the final spend, and the last changes live there, and
        // they are what a finished session gets opened for (#948). Scroll up for the history.
        <EventList events={events} stick={false} openAt="end" />
      )}
      {sessionId ? (
        <RunResumeChat projectId={projectId} runId={runId} sessionId={sessionId} driver={session?.driver} files={files} addContext={addContext} removeContext={removeContext} onRunStarted={onRunStarted} sessionName={sessionName} outcome={runOutcome(events)} />
      ) : (
        events.length > 0 && (
          // Say why there is no composer here, instead of a wordless dead-end (#948).
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            This session can&rsquo;t be continued — it ended before the agent reported a session id to resume.
          </p>
        )
      )}
    </>
  )
}
