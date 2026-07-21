import { useEffect, useState, type ReactNode } from 'react'
import type { FrameworkEvent } from '@gemstack/framework'
import { sessionInfo } from '@gemstack/framework/client'
import { Square, ExternalLink } from 'lucide-react'
import { sendStop } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { isRunActive } from '../lib/live-state.js'
import { describeSessionLink } from '../lib/session-link.js'
import { RemoveWorktreeButton } from './RemoveWorktreeButton.js'
import { WorkspaceActions } from './WorkspaceActions.js'
import { GitStatusBar } from './GitStatusBar.js'
import { Button, buttonVariants } from './ui/button.js'
import { CopyButton } from './ui/copy-button.js'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip.js'

// One run's action bar: Serve, Stop, and Open session as a single row of icon buttons with
// tooltips, instead of three stacked labeled rows. One bar for the session whether it is running
// or finished (RunView), so the controls stay put when a run reaches Done. Serve is a
// project-level action (always available); Stop shows only while the run is active; Open session
// appears once the run has reported one (honestly labeled — see describeSessionLink). A finished
// run that kept its worktree (#737) also gets a Remove.
export function RunActionBar({
  projectId,
  runId,
  events,
  retainedWorktree = false,
  onWorktreeRemoved,
  summary,
  expanded = false,
  onToggle,
  actions,
}: {
  projectId: string
  /** Which run Stop addresses (#749); absent falls back to the project's own control log. */
  runId?: string | null | undefined
  events: FrameworkEvent[]
  /** True when this finished run still has a worktree on disk, so it can be removed (#737). */
  retainedWorktree?: boolean
  /** Told after that worktree is removed, so the button goes. */
  onWorktreeRemoved?: () => void
  /** What the session's branch holds, said beside the branch itself (#1023). */
  summary?: ReactNode
  expanded?: boolean
  /** Given, the branch reads as a disclosure for the detail the caller renders under this bar. */
  onToggle?: (() => void) | undefined
  /** The session's next step (push, open PR), kept in the bar rather than behind the disclosure. */
  actions?: ReactNode
}) {
  // Stop routes through useAction like every other mutation: a click disables + shows "Stopping…"
  // and a failed stop surfaces instead of silently doing nothing.
  const { busy, error, run } = useAction()
  const active = isRunActive(events)
  // A landed stop keeps the button parked until the end event flips `active` (#948): useAction
  // resets busy on success, and for that gap the enabled button invited a redundant second stop.
  const [stopRequested, setStopRequested] = useState(false)
  useEffect(() => setStopRequested(false), [runId])
  const stopping = busy || (stopRequested && active)
  // Only a real per-session deep link is shown; the generic claude.ai/code entry is a dead end.
  // A session with an id but no deep link still gets its id offered for copy (#948): it is the
  // exact string a --resume takes, and it used to live only as a mono line buried in the feed.
  const info = sessionInfo(events)
  const session = describeSessionLink(info)

  return (
    // One row, always (#1026). The branch and its summary give up width as the row fills; the
    // buttons never drop under them, because a bar that reflows moves everything below it.
    <div className="@container flex items-center gap-2 overflow-hidden border-b border-border px-4 py-2">
      <TooltipProvider delay={300} closeDelay={0}>
        {/* Where this session is working (#798/#809): the same status the project home shows,
            read from this session's own worktree — its branch, whether it is holding uncommitted
            work, its size on disk, and the PR its branch has. */}
        <GitStatusBar projectId={projectId} runId={runId} inline summary={summary} expanded={expanded} onToggle={onToggle} />
        {error && <span className="truncate text-xs text-danger">{error}</span>}
        {/* What the session IS sits at the start of the bar; what you can DO to it sits at the end,
            so the buttons keep one home as the row's contents come and go (Stop only while it runs,
            Remove only on a retained worktree, Open session only once one is reported). */}
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
        {/* The handoff's next step sits before the workspace icons: it is the one thing here that
            moves the session forward rather than just opening it somewhere. */}
        {actions}
        {/* GitHub, folder, editor and Serve, addressed to this session's worktree (#809). */}
        <WorkspaceActions projectId={projectId} runId={runId} />
        {active && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Stop session"
                  disabled={stopping}
                  onClick={() =>
                    void run(() => sendStop(projectId, runId ?? undefined).then(() => true), 'Could not stop the session.').then(
                      result => result && setStopRequested(true),
                    )
                  }
                />
              }
            >
              <Square className="h-3 w-3 fill-current" />
            </TooltipTrigger>
            <TooltipContent>{stopping ? 'Stopping…' : 'Stop session'}</TooltipContent>
          </Tooltip>
        )}
        {/* A retained worktree only exists for a finished run, so this never sits beside Stop. */}
        {retainedWorktree && !active && runId && (
          <RemoveWorktreeButton projectId={projectId} runId={runId} onRemoved={() => onWorktreeRemoved?.()} />
        )}
        {!session && info?.sessionId && (
          <CopyButton text={info.sessionId} label={`Copy session id (${info.sessionId})`} className="p-1.5" />
        )}
        {session && (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={session.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={session.label.replace(' ↗', '')}
                  className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                />
              }
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{session.label.replace(' ↗', '')}</TooltipContent>
          </Tooltip>
        )}
        </div>
      </TooltipProvider>
    </div>
  )
}
