import type { FrameworkEvent } from '@gemstack/framework'
import { sessionInfo } from '@gemstack/framework/client'
import { Square, ExternalLink } from 'lucide-react'
import { sendStop } from '../server/control.telefunc.js'
import { useAction } from '../lib/use-action.js'
import { isRunActive } from '../lib/live-state.js'
import { describeSessionLink } from '../lib/session-link.js'
import { PreviewBar } from './PreviewBar.js'
import { Button, buttonVariants } from './ui/button.js'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip.js'

// One run's action bar: Serve, Stop, and Open session as a single row of icon buttons with
// tooltips, instead of three stacked labeled rows. Shared by the live view (RunLive) and the
// finished replay (RunReplay), so the controls stay put when a run reaches Done. Serve is a
// project-level action (always available); Stop shows only while the run is active; Open session
// appears once the run has reported one (honestly labeled — see describeSessionLink).
export function RunActionBar({
  projectId,
  runId,
  events,
}: {
  projectId: string
  /** Which run Stop addresses (#749); absent falls back to the project's own control log. */
  runId?: string | null | undefined
  events: FrameworkEvent[]
}) {
  // Stop routes through useAction like every other mutation: a click disables + shows "Stopping…"
  // and a failed stop surfaces instead of silently doing nothing.
  const { busy, error, run } = useAction()
  const active = isRunActive(events)
  // Only a real per-session deep link is shown; the generic claude.ai/code entry is a dead end,
  // so Claude Code runs get no Open button (the session id is still in the event log).
  const session = describeSessionLink(sessionInfo(events))

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
      <TooltipProvider delay={300} closeDelay={0}>
        {/* Serve the project's built result (its own icon button + tooltip). */}
        <PreviewBar projectId={projectId} inline />
        {active && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => void run(() => sendStop(projectId, runId ?? undefined), 'Could not stop the run.')}
                />
              }
            >
              <Square className="h-3 w-3 fill-current" />
            </TooltipTrigger>
            <TooltipContent>{busy ? 'Stopping…' : 'Stop run'}</TooltipContent>
          </Tooltip>
        )}
        {session && (
          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={session.href}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'icon-sm' })}
                />
              }
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>{session.label.replace(' ↗', '')}</TooltipContent>
          </Tooltip>
        )}
      </TooltipProvider>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
