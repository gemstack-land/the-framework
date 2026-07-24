import type { ReactNode } from 'react'
import type { FrameworkEvent } from '@gemstack/the-framework'
import { GitStatusBar } from './GitStatusBar.js'
import { SessionActionsMenu } from './SessionActionsMenu.js'

// One run's action bar: what the session IS (its branch / PR / summary, as a disclosure) on the
// left, and what you can DO to it on the right. The doing is a single ⋮ overflow menu
// (SessionActionsMenu) instead of a row of icon buttons that came and went with the run's state;
// only the handoff's next step (Push / Open PR) stays out as a visible button, since it moves the
// work forward. One bar for the session whether running or finished (RunView), so the controls stay
// put when a run reaches Done.
export function RunActionBar({
  projectId,
  runId,
  events,
  retainedWorktree = false,
  onWorktreeRemoved,
  onDeleted,
  label,
  projectName,
  summary,
  expanded = false,
  onToggle,
  actions,
}: {
  projectId: string
  /** Which run Stop addresses (#749); absent falls back to the project's own control log. */
  runId?: string | null | undefined
  events: FrameworkEvent[]
  /** The session's name — leads the bar, so the branch is git context, not the identity (#1030). */
  label?: string | undefined
  /** The session's project, shown as a `project / session` breadcrumb before the name. */
  projectName?: string | null | undefined
  /** True when this finished run still has a worktree on disk, so it can be removed (#737). */
  retainedWorktree?: boolean
  /** Told after that worktree is removed, so the menu item goes. */
  onWorktreeRemoved?: () => void
  /** Told after this session is deleted, so the caller can leave it (#1032). Given only for a
   * finished run: absent, no delete is offered. */
  onDeleted?: (() => void) | undefined
  /** What the session's branch holds, said beside the branch itself (#1023). */
  summary?: ReactNode
  expanded?: boolean
  /** Given, the branch reads as a disclosure for the detail the caller renders under this bar. */
  onToggle?: (() => void) | undefined
  /** The session's next step (push, open PR), kept in the bar rather than in the ⋮ menu. */
  actions?: ReactNode
}) {
  return (
    // One row, always (#1026). The branch and its summary give up width as the row fills; the
    // controls never drop under them, because a bar that reflows moves everything below it.
    <div className="@container flex items-center gap-2 overflow-hidden border-b border-border px-4 py-2">
      {/* Where this session is working (#798/#809): its branch, whether it holds uncommitted work,
          its size on disk, and the PR its branch has — read from this session's own worktree. */}
      <GitStatusBar projectId={projectId} runId={runId} inline label={label} projectName={projectName} summary={summary} expanded={expanded} onToggle={onToggle} />
      {/* What the session IS sits at the start; what you can DO to it sits at the end. The spacer
          grows but never shrinks (#1030), so a tight row takes its width from the label. */}
      <div className="grow shrink-0" />
      <div className="flex shrink-0 items-center gap-2">
        {/* The handoff's next step stays visible — the one thing here that moves the session forward
            rather than just opening it somewhere. Everything else is in the ⋮ menu. */}
        {actions}
        <SessionActionsMenu
          projectId={projectId}
          runId={runId}
          events={events}
          label={label}
          retainedWorktree={retainedWorktree}
          onWorktreeRemoved={onWorktreeRemoved}
          onDeleted={onDeleted}
        />
      </div>
    </div>
  )
}
