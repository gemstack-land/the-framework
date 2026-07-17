import { useEffect, useState } from 'react'
import { Play, ExternalLink, Square, ChevronDown } from 'lucide-react'
import type { ServeTarget } from '@gemstack/framework'
import { sendPreview, onServeTargets, sendStopPreview, onPreviewStatus } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { Button } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip.js'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuGroup, DropdownMenuLabel } from './ui/dropdown-menu.js'

// On-demand app Serve (#475): a per-project button that serves the project's built result
// (its dev script, else a static server) and surfaces the live URL + a Stop. Independent of
// any agent run — it closes the "let me see what it produced" loop with one click, useful for
// non-technical users too. State lives daemon-side, so a reload rehydrates via onPreviewStatus.
// `inline` renders just the control (for the project action bar); otherwise a full labelled row.
//
// Multi-package repos (#651): a monorepo has several servable apps, so onServeTargets lists them
// and the Serve button becomes a split control — the primary serves the last pick (the daemon
// remembers), a caret opens the picker. A single-app repo keeps the plain one-click button.
export function PreviewBar({ projectId, inline = false }: { projectId: string; inline?: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [command, setCommand] = useState<string | null>(null)
  const [targets, setTargets] = useState<ServeTarget[]>([])
  const { busy, error, reset, run } = useAction()

  // Rehydrate on load / project switch: reflect a preview the daemon is already serving, and
  // list the project's servable apps so the picker knows whether to offer a choice.
  useEffect(() => {
    let live = true
    setUrl(null)
    setCommand(null)
    setTargets([])
    reset()
    void onPreviewStatus(projectId).then(status => {
      if (!live || !status.running) return
      setUrl(status.url ?? null)
      setCommand(status.command ?? null)
    })
    void onServeTargets(projectId).then(list => {
      if (live) setTargets(list)
    })
    return () => {
      live = false
    }
  }, [projectId, reset])

  // Serve the given app (or the daemon's remembered/default one when no id is passed).
  const open = async (targetId?: string) => {
    const result = await run(() => sendPreview(projectId, targetId), 'Failed to start the preview.')
    if (result?.ok) {
      setUrl(result.url)
      setCommand(result.command)
    }
  }

  const stop = async () => {
    const stopped = await run(async () => {
      await sendStopPreview(projectId)
      return true as const
    }, 'Failed to stop the preview.')
    if (stopped) {
      setUrl(null)
      setCommand(null)
    }
  }

  // The control (all icon-only, h-7 to match the other actions): once serving, a segmented pair —
  // Open (the live URL ↗) joined to a Stop (⏹). When stopped, a plain Serve button, or — in a
  // multi-package repo — a split Serve + caret picker over the servable apps.
  const controls = (
    <TooltipProvider delay={300} closeDelay={0}>
      {url ? (
        <div className="inline-flex h-7 items-center overflow-hidden rounded-md border border-border">
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-full items-center px-2 hover:bg-accent hover:text-accent-foreground"
                />
              }
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>Open in browser</TooltipContent>
          </Tooltip>
          <span className="h-full w-px bg-border" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => void stop()}
                  disabled={busy}
                  className="flex h-full items-center px-2 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                />
              }
            >
              <Square className="h-3 w-3 fill-current" />
            </TooltipTrigger>
            <TooltipContent>Stop serving</TooltipContent>
          </Tooltip>
        </div>
      ) : targets.length > 1 ? (
        <div className="inline-flex h-7 items-center overflow-hidden rounded-md border border-border">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => void open()}
                  disabled={busy}
                  className="flex h-full items-center px-2 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                />
              }
            >
              <Play className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{busy ? 'Starting…' : 'Serve the last app'}</TooltipContent>
          </Tooltip>
          <span className="h-full w-px bg-border" />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    disabled={busy}
                    className="flex h-full items-center px-1.5 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                  />
                }
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent>Pick an app to serve</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Serve which app</DropdownMenuLabel>
                {targets.map(t => (
                  <DropdownMenuItem key={t.id} onClick={() => void open(t.id)}>
                    <span className="truncate">{t.label}</span>
                    <span className="ml-auto pl-3 text-xs text-muted-foreground">{t.script}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon-sm" disabled={busy} onClick={() => void open()} />}>
            <Play className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent>{busy ? 'Starting…' : 'Serve the built result'}</TooltipContent>
        </Tooltip>
      )}
    </TooltipProvider>
  )

  // Inline: just the control, for the project action bar. Errors sit below on their own line.
  if (inline) {
    return (
      <>
        {controls}
        {error && <p className="w-full text-xs text-red-500">{error}</p>}
      </>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">Serve</span>
      {!url && <span className="text-muted-foreground">Serve this project's built result</span>}
      <span className="ml-auto flex items-center gap-2">{controls}</span>
      {error && <p className="w-full text-red-500">{error}</p>}
    </div>
  )
}
