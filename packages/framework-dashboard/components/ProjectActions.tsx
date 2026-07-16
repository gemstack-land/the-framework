import { useEffect, useState } from 'react'
import { Github, FolderOpen, Code } from 'lucide-react'
import { onGithubUrl } from '../server/reads.telefunc.js'
import { useLoaded } from '../lib/use-async.js'
import { sendOpenInApp } from '../server/control.telefunc.js'
import { PreviewBar } from './PreviewBar.js'
import { GitStatusBar } from './GitStatusBar.js'
import { Button, buttonVariants } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip.js'

// Project-panel quick actions (#488). "Open on GitHub" (#489) when the repo has a github.com
// remote, plus localhost-only "Open folder" / "Open in editor" (#490) that ask the daemon to
// spawn the OS file manager / editor on the project's path. This bar only renders in the local
// dashboard (the relay shows RelayView instead), so the localhost actions never appear there.
export function ProjectActions({ projectId }: { projectId: string }) {
  const githubUrl = useLoaded<string | null>(() => onGithubUrl(projectId), null, [projectId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `error` belongs to open(), not to the read, so clearing it on a switch is its own effect:
  // otherwise the last project's failure stays on screen next to the new project's actions.
  useEffect(() => setError(null), [projectId])

  const open = async (target: 'files' | 'editor') => {
    setBusy(true)
    setError(null)
    try {
      const result = await sendOpenInApp(projectId, target)
      if (!result.ok) setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      {/* Git status (#491) reads on the left; the project actions group on the right. Nav
          actions are icon-only with tooltips; Serve keeps its label + running state. */}
      <GitStatusBar projectId={projectId} inline />
      <TooltipProvider delay={300} closeDelay={0}>
        <span className="ml-auto flex flex-wrap items-center gap-2">
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
            <TooltipContent>Open folder (Finder / Explorer)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="outline" size="icon-sm" disabled={busy} onClick={() => void open('editor')} />}
            >
              <Code className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>Open in editor (code, or $FRAMEWORK_EDITOR)</TooltipContent>
          </Tooltip>
          {/* Serve (#475): one click to serve the built result, alongside the other actions. */}
          <PreviewBar projectId={projectId} inline />
        </span>
      </TooltipProvider>
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
    </div>
  )
}
