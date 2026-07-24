import type { LoopStatus } from '@gemstack/the-framework/client'
import { Badge } from './ui/badge.js'

// The production-grade loop's verdict (#431), rendered the same wherever it is shown: the session's
// right rail, and the overview strip the relay watch and the project home still render.
//
// It is a projection of the run's own `checklist` / `improve` / `done` bootstrap events, so it says
// what the framework's review loop found — the pass it is on, and what is still blocking.
export function LoopStatusCard({ loop }: { loop: LoopStatus }) {
  return (
    <section className="rounded-lg border border-border p-3">
      {/* Titled like the sidebar's "Recents": a section label in the same voice, not a card heading
          shouting in caps. Same size, weight and tone, so the two rails read as one app. */}
      <h3 className="mb-1 flex h-8 items-center gap-2 text-xs font-normal tracking-wide text-muted-foreground">
        Loop status
        {/* "ended early", not "stopped": the loop finishing without passing is not the user
            stopping the session, and the session's status label may say "stopped" for that. */}
        <Badge className={loop.productionGrade ? 'text-primary' : loop.finished ? 'text-muted-foreground' : ''}>
          {loop.productionGrade ? 'production-grade' : loop.finished ? 'ended early' : `pass ${loop.pass}`}
        </Badge>
      </h3>
      {loop.blockers.length > 0 ? (
        <ul className="space-y-0.5 text-xs">
          {loop.blockers.map((b, i) => (
            <li key={i} className="text-foreground">
              <span className="mr-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground align-middle" aria-hidden />
              {b}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {loop.passing ? 'No blockers — the checklist passed.' : `Pass ${loop.pass} in progress…`}
        </p>
      )}
    </section>
  )
}
