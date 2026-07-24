import { useEffect, useState } from 'react'
import type { FrameworkEvent, ServeTarget } from '@gemstack/the-framework'
import { sessionInfo } from '@gemstack/the-framework/client'
import { MoreVertical, Github, FolderOpen, Code, Check, Play, ExternalLink, Square, FolderX, Trash2 } from 'lucide-react'
import { onGithubUrl } from '../server/reads.telefunc.js'
import {
  sendOpenInApp,
  sendStop,
  sendRemoveWorktree,
  sendDeleteSession,
  sendPreview,
  onServeTargets,
  sendStopPreview,
  onPreviewStatus,
} from '../server/control.telefunc.js'
import type { EditorInfo } from '../server/preferences.telefunc.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { useDetectedEditors } from '../lib/editors.js'
import { isRunActive } from '../lib/live-state.js'
import { describeSessionLink } from '../lib/session-link.js'
import { cn } from '../lib/utils.js'
import { buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import { ConfirmDialog } from './ui/confirm-dialog.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './ui/dropdown-menu.js'

// One ⋮ overflow menu for everything you can DO to a session (#toolbar-menu), instead of a row of
// five-plus icon buttons that came and went with the run's state. It folds in what used to be
// WorkspaceActions (GitHub / folder / editor / Serve), the Stop button, Remove worktree, Open
// session, and Delete. The handoff's Push / Open PR stay visible in the bar — they move the work
// forward, not just open it somewhere. Serve keeps its state (Serve → Open/Stop, or a picker
// submenu in a multi-app repo); the editor keeps its preferred-editor submenu; Delete opens its
// confirm dialog (a menu item cannot also be the dialog's trigger, so the dialog is controlled).
export function SessionActionsMenu({
  projectId,
  runId,
  events,
  label,
  retainedWorktree = false,
  onWorktreeRemoved,
  onDeleted,
}: {
  projectId: string
  runId?: string | null | undefined
  events: FrameworkEvent[]
  label?: string | undefined
  retainedWorktree?: boolean
  onWorktreeRemoved?: (() => void) | undefined
  onDeleted?: (() => void) | undefined
}) {
  const active = isRunActive(events)
  const session = describeSessionLink(sessionInfo(events))
  // keepPrevious: hold the last repo URL while a new project's loads, so the item does not flicker.
  const githubUrl = useLoaded<string | null>(() => onGithubUrl(projectId), null, [projectId], true)

  const editor = usePreferences().editor
  const detectedEditors = useDetectedEditors()
  const editorRows: EditorInfo[] =
    editor && !detectedEditors.some(e => e.bin === editor) ? [...detectedEditors, { bin: editor, label: editor }] : detectedEditors

  // Serve state (#475), same as PreviewBar: rehydrate a preview the daemon is already running and
  // list the servable apps, so a multi-app repo offers a picker.
  const [url, setUrl] = useState<string | null>(null)
  const [targets, setTargets] = useState<ServeTarget[]>([])
  const { busy, error, reset, run } = useAction()
  useEffect(() => {
    let live = true
    setUrl(null)
    setTargets([])
    reset()
    void onPreviewStatus(projectId, runId ?? undefined).then(status => {
      if (live && status.running) setUrl(status.url ?? null)
    })
    void onServeTargets(projectId, runId ?? undefined).then(list => {
      if (live) setTargets(list)
    })
    return () => {
      live = false
    }
  }, [projectId, runId, reset])

  // A landed Stop stays "Stopping…" until the end event flips `active`, so it can't be re-fired.
  const [stopRequested, setStopRequested] = useState(false)
  useEffect(() => setStopRequested(false), [runId])
  const stopping = busy || (stopRequested && active)

  const [confirmDelete, setConfirmDelete] = useState(false)

  const openApp = (target: 'files' | 'editor') => run(() => sendOpenInApp(projectId, target, runId ?? undefined), 'Failed to open.')
  const serve = (targetId?: string) =>
    void run(() => sendPreview(projectId, targetId, runId ?? undefined), 'Failed to start the preview.').then(result => {
      if (result?.ok) setUrl(result.url)
    })
  const stopServe = () =>
    void run(async () => {
      await sendStopPreview(projectId, runId ?? undefined)
      return true as const
    }, 'Failed to stop the preview.').then(stopped => {
      if (stopped) setUrl(null)
    })
  const stopSession = () =>
    void run(() => sendStop(projectId, runId ?? undefined).then(() => true), 'Could not stop the session.').then(result => {
      if (result) setStopRequested(true)
    })
  const removeWorktree = () => {
    if (!runId) return
    void run(() => sendRemoveWorktree(projectId, runId), 'Could not remove the worktree.').then(result => {
      if (result !== undefined) onWorktreeRemoved?.()
    })
  }

  const name = label?.trim() || runId

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          aria-label="Session actions"
          title="Session actions"
          className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          {githubUrl && (
            <DropdownMenuItem render={<a href={githubUrl} target="_blank" rel="noreferrer" />}>
              <Github className="h-3.5 w-3.5 shrink-0" /> Open on GitHub
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={busy} onClick={() => void openApp('files')}>
            <FolderOpen className="h-3.5 w-3.5 shrink-0" /> {runId ? "Open session's folder" : 'Open folder'}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={busy}>
              <Code className="h-3.5 w-3.5 shrink-0" /> Open in editor
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[15rem]">
              <DropdownMenuItem disabled={busy} onClick={() => void openApp('editor')}>
                <Code className="h-3.5 w-3.5 shrink-0" /> {runId ? "Open this session's checkout" : 'Open in your editor'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Preferred editor</DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={busy}
                  closeOnClick={false}
                  onClick={() => updatePreferences({ editor: '' })}
                  className="items-start"
                >
                  <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor ? 'opacity-0' : 'opacity-100')} />
                  <OptionLabel label="Default" description="$FRAMEWORK_EDITOR, or code" />
                </DropdownMenuItem>
                {editorRows.map(e => (
                  <DropdownMenuItem
                    key={e.bin}
                    disabled={busy}
                    closeOnClick={false}
                    onClick={() => updatePreferences({ editor: e.bin })}
                    className="items-start"
                  >
                    <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor === e.bin ? 'opacity-100' : 'opacity-0')} />
                    <OptionLabel label={e.label} description={e.bin} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {session && (
            <DropdownMenuItem render={<a href={session.href} target="_blank" rel="noreferrer" />}>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {session.label.replace(' ↗', '')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {/* Serve: a live URL becomes Open + Stop; a multi-app repo offers a picker submenu. */}
          {url ? (
            <>
              <DropdownMenuItem render={<a href={url} target="_blank" rel="noreferrer" />}>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Open preview
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void stopServe()}>
                <Square className="h-3 w-3 shrink-0 fill-current" /> Stop serving
              </DropdownMenuItem>
            </>
          ) : targets.length > 1 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={busy}>
                <Play className="h-3.5 w-3.5 shrink-0" /> Serve
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Serve which app</DropdownMenuLabel>
                {targets.map(t => (
                  <DropdownMenuItem key={t.id} disabled={busy} onClick={() => serve(t.id)}>
                    <span className="truncate">{t.label}</span>
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{t.script}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled={busy} onClick={() => serve()}>
              <Play className="h-3.5 w-3.5 shrink-0" /> {busy ? 'Starting…' : 'Serve'}
            </DropdownMenuItem>
          )}
          {active && (
            <DropdownMenuItem disabled={stopping} onClick={() => void stopSession()}>
              <Square className="h-3 w-3 shrink-0 fill-current" /> {stopping ? 'Stopping…' : 'Stop session'}
            </DropdownMenuItem>
          )}

          {((retainedWorktree && !active) || (onDeleted && !active)) && runId && <DropdownMenuSeparator />}
          {retainedWorktree && !active && runId && (
            <DropdownMenuItem disabled={busy} onClick={() => removeWorktree()}>
              <FolderX className="h-3.5 w-3.5 shrink-0" /> Remove worktree
            </DropdownMenuItem>
          )}
          {onDeleted && !active && runId && (
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-danger">
              <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete session
            </DropdownMenuItem>
          )}

          {error && <p className="px-2 py-1.5 text-xs text-danger">{error}</p>}
        </DropdownMenuContent>
      </DropdownMenu>

      {onDeleted && runId && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this session?"
          body={
            <>
              Deleting <span className="font-medium text-foreground">{name}</span> removes it from the dashboard for good — its
              history can&rsquo;t be recovered. Its branch and any pull request stay in git.
            </>
          }
          confirmLabel="Delete"
          confirmBusyLabel="Deleting…"
          fallbackError="Could not delete the session."
          onConfirm={() => sendDeleteSession(projectId, runId).then(result => (result.ok ? result : Promise.reject(new Error(result.error))))}
          onSuccess={onDeleted}
        />
      )}
    </>
  )
}
