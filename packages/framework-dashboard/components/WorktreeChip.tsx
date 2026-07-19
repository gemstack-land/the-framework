import type { RunWorktree } from '@gemstack/framework'
import { GitBranch } from 'lucide-react'
import { onRunWorktree } from '../server/reads.telefunc.js'
import { sendOpenInApp } from '../server/control.telefunc.js'
import { usePolled } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { formatBytes } from '../lib/format-bytes.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// Where this session is working (#798). Every session since #736 runs in its own git worktree, and
// the dashboard said so nowhere: the git status bar reads the *project*, so a session's branch, its
// uncommitted work, and the directory it all lives in were invisible from the one view about that
// session. That is also what made worktrees feel like something that happens to you — the work is
// somewhere, you cannot see where, and when the run finishes the directory is gone.
//
// Clicking opens that checkout in the configured editor, which is the action you actually want
// while reading a session: go look at what it is holding.
export function WorktreeChip({ projectId, runId }: { projectId: string; runId: string }) {
  // Polled, not loaded once: the branch is renamed when the agent names the session (#736) and the
  // dirty flag changes under a working run, so a one-shot read would be a lie within seconds. Slow
  // cadence — this is a label, and the read shells out to git.
  const { value: worktree } = usePolled<RunWorktree | null>(
    () => onRunWorktree(projectId, runId),
    null,
    5000,
    [projectId, runId],
  )
  const { busy, error, run } = useAction()

  if (!worktree) return null

  const label = worktree.branch ?? (worktree.own ? 'worktree' : 'project checkout')
  const size = formatBytes(worktree.sizeBytes, '')
  // The tooltip carries what the chip cannot: the full path, and what "dirty" means here. On the
  // fallback checkout (a project with no git repo) uncommitted work is the user's own, so it is
  // reported without the agent framing.
  const where = worktree.own ? worktree.path : `${worktree.path} (the project's own checkout, not a worktree)`
  const held = worktree.dirty ? (worktree.own ? 'Uncommitted changes in this session' : 'Uncommitted changes') : null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 max-w-[16rem] gap-1.5 px-2 font-normal"
            disabled={busy}
            onClick={() => void run(() => sendOpenInApp(projectId, 'editor', runId), 'Could not open the worktree.')}
          />
        }
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate text-xs">{label}</span>
        {worktree.dirty && <span className="shrink-0 text-xs text-amber-500">•</span>}
        {size && <span className="shrink-0 text-xs text-muted-foreground">{size}</span>}
        {error && <span className="sr-only">{error}</span>}
      </TooltipTrigger>
      <TooltipContent>
        <span className="block max-w-xs break-all">{where}</span>
        {held && <span className="block text-muted-foreground">{held}</span>}
        <span className="block text-muted-foreground">{busy ? 'Opening…' : 'Click to open in your editor'}</span>
        {error && <span className="block text-red-400">{error}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
