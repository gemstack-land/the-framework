import type { FrameworkEvent } from '@gemstack/framework'
import { runProgress, sessionInfo } from '@gemstack/framework/client'
import { useCallback, useState } from 'react'
import { onRun, onRetainedWorktrees } from '../server/reads.telefunc.js'
import { EventList } from './EventList.js'
import { RunActionBar } from './RunActionBar.js'
import { RunHandoffPanel } from './RunHandoffPanel.js'
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
  // null until the first answer: "Loading session…" and "no events" are different things.
  const events = useLoaded<FrameworkEvent[] | null>(() => onRun(projectId, runId), null, [projectId, runId])
  // Whether this run kept its worktree (#737): a failed/stopped run does, a clean one had it
  // removed when it finished. Drives the Remove button, and is cleared locally once removed so
  // the button goes without waiting for a refetch.
  const retained = useLoaded<string[]>(() => onRetainedWorktrees(projectId), [], [projectId, runId])
  const [removed, setRemoved] = useState(false)
  const hasWorktree = !removed && retained.includes(runId)
  const onWorktreeRemoved = useCallback(() => setRemoved(true), [])

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
      />
      {/* What this session produced and what to do with it (#799). Directly under the action bar,
          because it is the first thing you want from a finished session and the last thing the
          dashboard could answer. */}
      <RunHandoffPanel projectId={projectId} runId={runId} />
      {events.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">This session has no events.</div>
      ) : (
        <EventList events={events} stick={false} />
      )}
      {sessionId && (
        <RunResumeChat projectId={projectId} runId={runId} sessionId={sessionId} driver={session?.driver} files={files} addContext={addContext} onRunStarted={onRunStarted} sessionName={sessionName} />
      )}
    </>
  )
}
