import { FolderX } from 'lucide-react'
import { sendRemoveWorktree } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'

// Remove a retained worktree (#737). A run that failed or was stopped keeps its checkout so you
// can go look at what it was holding when it died; nothing removes those on a timer, so this is
// the way they go. Rendered only for a finished run that still has one, so its absence is the
// signal that there is nothing on disk to clean up.
//
// It sits in the action bar rather than on the Runs rail row: a rail row IS a button (selecting
// the run), and a button inside a button is invalid DOM. Same place you already reach for Serve
// and Open session on a finished run, one click from the run you are inspecting.
export function RemoveWorktreeButton({
  projectId,
  runId,
  onRemoved,
}: {
  projectId: string
  runId: string
  /** Told after a successful removal, so the caller can drop the button. */
  onRemoved: () => void
}) {
  const { busy, error, run } = useAction()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Remove this session's worktree"
            disabled={busy}
            onClick={() =>
              void run(() => sendRemoveWorktree(projectId, runId), 'Could not remove the worktree.').then(
                result => result !== undefined && onRemoved(),
              )
            }
          />
        }
      >
        <FolderX className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent>
        {error ?? (busy ? 'Removing…' : "Remove this session's worktree (its history is already saved)")}
      </TooltipContent>
    </Tooltip>
  )
}
