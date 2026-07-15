import type { FrameworkEvent } from '@gemstack/framework'
import { loopStatus, sessionInfo, deployPlan, runProgress } from '@gemstack/framework/client'
import { Badge } from './ui/badge.js'
import { cn } from '../lib/utils.js'

// The run overview (#431): the "moat" the wrapped agent's own chat cannot show, rebuilt
// on the new dashboard. Each card is a pure projection of the event stream (run-view.ts
// in @gemstack/framework) — the production-grade loop status, the deploy plan, and a link
// to the live session. Cards render only when their data has arrived, so an early run
// shows nothing extra.
export function RunOverview({ events }: { events: FrameworkEvent[] }) {
  const loop = loopStatus(events)
  const session = sessionInfo(events)
  const deploy = deployPlan(events)
  const progress = runProgress(events)
  const hasProgress = Boolean(progress.sessionName) || progress.readyForMerge

  if (!loop && !deploy && !session?.sessionLink && !hasProgress) return null

  return (
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
      {hasProgress && (
        <div className="flex items-center gap-2 text-sm md:col-span-2">
          <span
            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', progress.readyForMerge ? 'bg-green-500' : 'animate-pulse bg-amber-500')}
          />
          {progress.sessionName && <span className="font-medium">{progress.sessionName}</span>}
          <span className="text-xs text-muted-foreground">{progress.readyForMerge ? 'ready for merge' : 'building…'}</span>
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

      {session?.sessionLink && (
        <a
          href={session.sessionLink}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary underline underline-offset-2 md:col-span-2"
        >
          Open session{session.sessionId ? ` (${session.sessionId})` : ''} ↗
        </a>
      )}
    </div>
  )
}
