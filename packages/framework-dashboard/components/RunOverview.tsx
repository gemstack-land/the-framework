import type { FrameworkEvent } from '@gemstack/framework'
import { loopStatus, sessionInfo, deployPlan, runProgress } from '@gemstack/framework/client'
import { Badge } from './ui/badge.js'
import { isRunActive } from '../lib/live-state.js'
import { describeSessionLink } from '../lib/session-link.js'
import { cn } from '../lib/utils.js'

// The run overview (#431): the "moat" the wrapped agent's own chat cannot show, rebuilt
// on the new dashboard. Each card is a pure projection of the event stream (run-view.ts
// in @gemstack/framework) — the production-grade loop status, the deploy plan, and a link
// to the live session. Cards render only when their data has arrived, so an early run
// shows nothing extra.
export function RunOverview({ events, showSessionLink = true }: { events: FrameworkEvent[]; showSessionLink?: boolean }) {
  const loop = loopStatus(events)
  const session = sessionInfo(events)
  const deploy = deployPlan(events)
  const progress = runProgress(events)
  const hasProgress = Boolean(progress.sessionName) || progress.readyForMerge
  // A run only pulses "building…" while it's live (#695/U20): once the `end` event lands the
  // pill must settle to the final state ("ready for merge" or "finished") instead of pulsing on.
  const active = isRunActive(events)

  // The "Open session" link, labeled honestly: a headless Claude Code run has no per-session
  // URL, so the generic app entry (claude.ai/code) is shown as "Open Claude Code" with the id
  // surfaced separately, not as a deep link to that id. See {@link describeSessionLink}. The
  // run's own view moves this into its action bar, so it opts out via `showSessionLink={false}`.
  const sessionLink = showSessionLink ? describeSessionLink(session) : null

  if (!loop && !deploy && !sessionLink && !hasProgress) return null

  return (
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
      {hasProgress && (
        <div className="flex items-center gap-2 text-sm md:col-span-2">
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              progress.readyForMerge ? 'bg-green-500' : active ? 'animate-pulse bg-amber-500' : 'bg-muted-foreground',
            )}
            aria-hidden
          />
          {progress.sessionName && <span className="font-medium">{progress.sessionName}</span>}
          <span className="text-xs text-muted-foreground">
            {progress.readyForMerge ? 'ready for merge' : active ? 'building…' : 'finished'}
          </span>
        </div>
      )}
      {loop && (
        <section className="rounded-lg border border-border p-3">
          <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Loop status
            <Badge className={loop.productionGrade ? 'text-primary' : loop.finished ? 'text-muted-foreground' : ''}>
              {loop.productionGrade ? 'production-grade' : loop.finished ? 'stopped' : `pass ${loop.pass}`}
            </Badge>
          </h3>
          {loop.blockers.length > 0 ? (
            <ul className="space-y-0.5 text-xs">
              {loop.blockers.map((b, i) => (
                <li key={i} className="text-foreground">
                  <span className="text-muted-foreground">☐</span> {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {loop.passing ? 'No blockers — the checklist passed.' : `Pass ${loop.pass} in progress…`}
            </p>
          )}
        </section>
      )}

      {deploy && (
        <section className="rounded-lg border border-border p-3 md:col-span-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deploy</h3>
          <p className="text-sm">
            <span className="font-medium uppercase">{deploy.render}</span> → {deploy.target}
            <span className="text-muted-foreground"> ({deploy.reason})</span>
          </p>
        </section>
      )}

      {sessionLink && (
        <a
          href={sessionLink.href}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline underline-offset-2 md:col-span-2"
        >
          {sessionLink.label}
        </a>
      )}
    </div>
  )
}
