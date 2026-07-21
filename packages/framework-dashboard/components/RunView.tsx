import { useCallback, useState } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { runProgress, sessionInfo } from '@gemstack/framework/client'
import { onRun, onRetainedWorktrees } from '../server/reads.telefunc.js'
import { useLoaded } from '../lib/use-async.js'
import { useRunHandoff } from '../lib/use-run-handoff.js'
import { runOutcome } from '../lib/live-state.js'
import { RunActionBar } from './RunActionBar.js'
import { RunComposer } from './RunComposer.js'
import { RunFeed } from './RunFeed.js'
import { ChangesSummary, RunChanges } from './RunChanges.js'
import { HandoffActions, HandoffSummary, RunHandoffDetails, handoffExpandable } from './RunHandoff.js'

// One session's view, whether it is running or finished (#1026).
//
// This used to be two components — RunLive and RunReplay — and the page swapped one for the other
// the instant a run's status flipped. Everything remounted at once: the action bar blanked while
// its git read went out again, the output was replaced by "Loading session…" while the archived
// log was fetched, the run overview disappeared, and the composer was rebuilt. A session ending is
// the moment you are most likely to be reading it, and the whole page flinched.
//
// So the frame is stable and only its contents change: the same bar, feed and composer stay
// mounted, and `live` decides what they say. The log is the same log — while the run is live it
// arrives over the channel, and once it ends the archived copy is read and swapped in behind the
// events already on screen.
export function RunView({
  projectId,
  runId,
  events,
  live,
  label,
  files,
  addContext,
  removeContext,
  lost = false,
  onRunStarted,
}: {
  projectId: string
  /** Which run this is (#749); absent right after Start, before the poll adopts its id. */
  runId?: string | null | undefined
  /** The live channel's events for this run — all there is while it runs. */
  events: FrameworkEvent[]
  /** Whether the run is still running. */
  live: boolean
  /** The session's own name — the same label the rail shows (#1030). It leads the action bar as
   * the stable identity, so the branch renaming itself near the end of a run (#736) reads as a
   * detail changing rather than the whole view changing. */
  label?: string | undefined
  files: string[]
  addContext: (path: string) => void
  removeContext?: ((path: string) => void) | undefined
  /** The live channel's health (#948) — surfaced as a banner over the feed. */
  lost?: boolean
  /** Jump to the run a preset or a continuation started (#959). */
  onRunStarted?: ((intent: string, runId?: string) => void) | undefined
}) {
  // The archived log, read only once the run has ended: while it runs, the channel is the truth.
  const archived = useLoaded<FrameworkEvent[] | null>(
    !live && runId ? () => onRun(projectId, runId) : null,
    null,
    [projectId, runId, live],
  )
  // Whether this run kept its worktree (#737): a failed/stopped run does, a clean one had it
  // removed when it finished. Drives the Remove button, and is cleared locally once removed so
  // the button goes without waiting for a refetch.
  const retained = useLoaded<string[]>(!live && runId ? () => onRetainedWorktrees(projectId) : null, [], [projectId, runId, live])
  const [removed, setRemoved] = useState(false)
  const onWorktreeRemoved = useCallback(() => setRemoved(true), [])
  const hasWorktree = !live && !removed && runId !== null && runId !== undefined && retained.includes(runId)

  // What the branch holds (#1023), read once for both the bar and the detail it opens. Only a
  // finished run has a handoff: while it runs, what matters is what it has touched so far.
  const handoff = useRunHandoff(projectId, runId ?? null, !live)
  const [changes, setChanges] = useState({ count: 0, added: 0, removed: 0 })
  const [open, setOpen] = useState(false)
  const onChangesSummary = useCallback((count: number, added: number, removed: number) => {
    setChanges(prev => (prev.count === count && prev.added === added && prev.removed === removed ? prev : { count, added, removed }))
  }, [])
  const toggle = useCallback(() => setOpen(o => !o), [])

  // The events already on screen keep their place while the archived copy is read, so a run
  // ending swaps the source without blanking the output.
  const shown = live ? events : (archived ?? events)
  const session = sessionInfo(shown)
  const progress = runProgress(shown)
  // Until the handoff has actually loaded, a just-stopped run keeps showing the file counts it
  // ended with (#1030): the summary swaps once, from the live counts to the handoff, instead of
  // blanking for the beat the handoff read takes. Same for the chevron, so it does not blink out.
  const showHandoff = !live && handoff.loaded
  const canExpand = showHandoff ? handoffExpandable(handoff.handoff) : changes.count > 0

  return (
    <>
      <RunActionBar
        projectId={projectId}
        runId={runId}
        events={shown}
        label={label ?? progress.sessionName}
        retainedWorktree={hasWorktree}
        onWorktreeRemoved={onWorktreeRemoved}
        summary={
          showHandoff ? (
            <>
              <HandoffSummary handoff={handoff.handoff} />
              {handoff.error && <span className="text-danger">{handoff.error}</span>}
            </>
          ) : (
            <ChangesSummary {...changes} />
          )
        }
        expanded={open}
        {...(canExpand ? { onToggle: toggle } : {})}
        actions={runId ? <HandoffActions projectId={projectId} runId={runId} state={handoff} /> : undefined}
      />
      {/* What the session has touched, behind the branch row's disclosure. While it runs that is
          its worktree; once it ends, the branch it left behind. The live read needs the run's id:
          without one it falls back to the project root and would report the user's own dirty
          files as the run's. */}
      {live && runId && <RunChanges projectId={projectId} runId={runId} open={open} onSummary={onChangesSummary} />}
      {!live && open && <RunHandoffDetails handoff={handoff.handoff} />}
      {/* Nothing to show yet is not the same thing in both states: a live run is waiting for its
          first event, a finished one is still reading its log. */}
      {!live && archived === null && shown.length === 0 ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">Loading session…</div>
      ) : (
        // A finished log is static, so it does not follow new output; it opens at the end, where
        // the outcome, the final spend and the last changes are (#948).
        <RunFeed
          events={shown}
          showSessionLink={false}
          lost={lost}
          {...(live ? {} : { stick: false, openAt: 'end' as const, emptyLabel: 'This session has no events.' })}
        />
      )}
      <RunComposer
        projectId={projectId}
        runId={runId}
        live={live}
        sessionId={session?.sessionId}
        driver={session?.driver}
        files={files}
        addContext={addContext}
        removeContext={removeContext}
        sessionName={progress.sessionName}
        onRunStarted={onRunStarted}
        outcome={live ? undefined : runOutcome(shown)}
      />
    </>
  )
}
