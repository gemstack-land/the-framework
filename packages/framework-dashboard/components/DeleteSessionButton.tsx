import { Trash2 } from 'lucide-react'
import { sendDeleteSession } from '../server/control.telefunc.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import { Button } from './ui/button.js'

// Delete a finished session (#1032): take it out of the dashboard, records and all — the sibling
// of Remove worktree, which keeps the session and only reclaims its checkout. This removes the run
// meta and its event log too, so the row is gone for good; that is why it confirms, where remove
// does not. It leaves the branch and any PR alone, because those are git history the dashboard has
// no business rewriting from a trash icon.
//
// Only for a finished run (the caller renders it when the run is not live), and the confirm refuses
// server-side while a run is still going regardless. It sits in the action bar beside Remove, one
// click from the session you are looking at.
export function DeleteSessionButton({
  projectId,
  runId,
  label,
  onDeleted,
}: {
  projectId: string
  runId: string
  /** The session's own name, so the dialog says which one is going, not a bare id. */
  label?: string | undefined
  /** Told after a successful delete, so the caller can leave the now-gone session. */
  onDeleted: () => void
}) {
  const name = label?.trim() || runId
  return (
    <ConfirmDialog
      title="Delete this session?"
      body={
        <>
          Deleting <span className="font-medium text-foreground">{name}</span> removes it from the dashboard for good
          — its history can&rsquo;t be recovered. Its branch and any pull request stay in git.
        </>
      }
      confirmLabel="Delete"
      confirmBusyLabel="Deleting…"
      fallbackError="Could not delete the session."
      onConfirm={() => sendDeleteSession(projectId, runId).then(result => (result.ok ? result : Promise.reject(new Error(result.error))))}
      onSuccess={onDeleted}
      trigger={
        // A plain titled button, not a Tooltip: the dialog's own trigger owns this element, and two
        // Base UI triggers cannot share one. The confirm dialog is the real explanation anyway.
        <Button variant="outline" size="icon-sm" aria-label="Delete this session" title="Delete this session">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      }
    />
  )
}
