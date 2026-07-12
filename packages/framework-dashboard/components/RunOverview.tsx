import type { FrameworkEvent } from '@gemstack/framework'
import { architectPlan, decisionLedger, loopStatus, sessionInfo, deployPlan } from '@gemstack/framework/client'
import { Badge } from './ui/badge.js'

// The run overview (#431): the "moat" the wrapped agent's own chat cannot show, rebuilt
// on the new dashboard. Each card is a pure projection of the event stream (run-view.ts
// in @gemstack/framework) — the chosen stack + PROS/CONS + rejected alternatives, the
// decisions ledger, the production-grade loop status, and a link to the live session.
// Cards render only when their data has arrived, so an early run shows nothing extra.
export function RunOverview({ events }: { events: FrameworkEvent[] }) {
  const plan = architectPlan(events)
  const ledger = decisionLedger(events)
  const loop = loopStatus(events)
  const session = sessionInfo(events)
  const deploy = deployPlan(events)

  if (!plan && !loop && !deploy && !session?.sessionLink) return null

  return (
    <div className="grid gap-3 border-b border-border p-4 md:grid-cols-2">
      {plan && (
        <section className="rounded-lg border border-border p-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stack &amp; rationale</h3>
          <p className="text-sm font-medium">{plan.stack}</p>
          {(plan.pros.length > 0 || plan.cons.length > 0) && (
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <ul className="space-y-0.5">
                {plan.pros.map((p, i) => (
                  <li key={i} className="text-foreground">
                    <span className="text-primary">＋</span> {p}
                  </li>
                ))}
              </ul>
              <ul className="space-y-0.5">
                {plan.cons.map((c, i) => (
                  <li key={i} className="text-muted-foreground">
                    <span>－</span> {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.alternatives.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Considered: {plan.alternatives.map(a => `${a.option} (${a.whyNot})`).join('; ')}
            </p>
          )}
        </section>
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

      {ledger.length > 0 && (
        <section className="rounded-lg border border-border p-3 md:col-span-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Decisions ledger</h3>
          <ul className="space-y-0.5 text-xs">
            {ledger.map((d, i) => (
              <li key={i} className={d.rejected ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground'}>
                <span className="font-medium">{d.choice}</span>
                <span className="text-muted-foreground"> — {d.why}</span>
              </li>
            ))}
          </ul>
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
