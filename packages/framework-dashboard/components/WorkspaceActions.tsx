import { useEffect } from 'react'
import { Github, FolderOpen, Code, Check } from 'lucide-react'
import { onGithubUrl } from '../server/reads.telefunc.js'
import { sendOpenInApp } from '../server/control.telefunc.js'
import type { EditorInfo } from '../server/preferences.telefunc.js'
import { useLoaded } from '../lib/use-async.js'
import { useAction } from '../lib/use-action.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { useDetectedEditors } from '../lib/editors.js'
import { cn } from '../lib/utils.js'
import { PreviewBar } from './PreviewBar.js'
import { Button, buttonVariants } from './ui/button.js'
import { OptionLabel } from './ui/option-label.js'
import { Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip.js'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// What you can do to a checkout: open it on GitHub (#489), in the file manager or an editor
// (#490), and serve it (#475). One component for both pages (#809) — the project home passes no
// session and acts on the project's tree, a session passes its id and every action addresses its
// own worktree instead. Opening a session in your editor is the whole point of a worktree, and
// that was the one page where you could not.
//
// Must be rendered inside a TooltipProvider; the bars that use it own the delay.
export function WorkspaceActions({
  projectId,
  runId,
}: {
  projectId: string
  /** The session to act on; absent acts on the project's checkout. */
  runId?: string | null | undefined
}) {
  // The repo link is the project's either way: a session is a branch of that same repo, and its
  // branch may not be pushed anywhere yet. Its PR, when there is one, shows in the git status.
  // keepPrevious: hold the GitHub icon while a new project's URL loads, so it does not pop out and
  // back and shove the icon row (within a project it is already stable, keyed on projectId).
  const githubUrl = useLoaded<string | null>(() => onGithubUrl(projectId), null, [projectId], true)
  const { busy, error, reset, run } = useAction()
  // The preferred editor lives with the action that opens it now (#727), not off in the options
  // gear: click to open, or pick which editor to remember. The stored one shows as a "custom" row
  // when it isn't auto-detected (a hand-set $FRAMEWORK_EDITOR), so the choice always appears.
  const editor = usePreferences().editor
  const detectedEditors = useDetectedEditors()
  const editorRows: EditorInfo[] =
    editor && !detectedEditors.some(e => e.bin === editor)
      ? [...detectedEditors, { bin: editor, label: editor }]
      : detectedEditors

  // `error` belongs to open(), not to the read, so clearing it on a switch is its own effect:
  // otherwise the last checkout's failure stays on screen next to the new one's actions.
  useEffect(() => reset(), [projectId, runId, reset])

  const open = (target: 'files' | 'editor') =>
    run(() => sendOpenInApp(projectId, target, runId ?? undefined), 'Failed to open.')

  return (
    <>
      {githubUrl && (
        <Tooltip>
          <TooltipTrigger
            render={
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
              />
            }
          >
            <Github className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>Open on GitHub</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="outline" size="icon-sm" disabled={busy} onClick={() => void open('files')} />}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent>{runId ? "Open this session's folder" : 'Open folder'} (Finder / Explorer)</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={busy}
          title="Open in editor"
          aria-label="Open in editor"
          className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
        >
          <Code className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[15rem]">
          <DropdownMenuItem disabled={busy} onClick={() => void open('editor')}>
            <Code className="h-3.5 w-3.5 shrink-0" />
            {runId ? "Open this session's checkout" : 'Open in your editor'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Preferred editor</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={busy}
              closeOnClick={false}
              onClick={() => updatePreferences({ editor: '' })}
              title="Use $FRAMEWORK_EDITOR, or VS Code"
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
                title={`Open in ${e.label} (${e.bin})`}
                className="items-start"
              >
                <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor === e.bin ? 'opacity-100' : 'opacity-0')} />
                <OptionLabel label={e.label} description={e.bin} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Serve (#475) the checkout this bar is about: the project's, or the session's own (#797). */}
      <PreviewBar projectId={projectId} runId={runId} inline />
      {error && <span className="text-xs text-danger">{error}</span>}
    </>
  )
}
