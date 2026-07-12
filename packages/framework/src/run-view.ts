import type { FrameworkEvent } from './events.js'

// Derived run state for the dashboard's overview cards (#431): the chosen stack + its
// rationale, the decisions ledger, the production-grade loop status, and the live session
// link — each a pure projection of the same FrameworkEvent stream the log renders, so the
// live dashboard and a past-run replay show the identical summary. Kept here (not in the
// dashboard) so it is unit-tested against the real event shapes. The bootstrap phase
// (architect/checklist/deploy) carries the structured data; we surface it as cards.

/** The architect's chosen stack and why (#431), from the last `architect` bootstrap event. */
export interface ArchitectPlan {
  stack: string
  decisions: { choice: string; why: string }[]
  pros: string[]
  cons: string[]
  alternatives: { option: string; whyNot: string }[]
}

/** The chosen stack + rationale, or null before the architect has run. Latest wins (#324 re-architect). */
export function architectPlan(events: readonly FrameworkEvent[]): ArchitectPlan | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind !== 'bootstrap' || event.event.type !== 'architect') continue
    const a = event.event
    return {
      stack: a.stack,
      decisions: a.decisions.map(d => ({ choice: d.choice, why: d.why })),
      pros: [...(a.pros ?? [])],
      cons: [...(a.cons ?? [])],
      alternatives: (a.alternatives ?? []).map(x => ({ option: x.option, whyNot: x.whyNot })),
    }
  }
  return null
}

/** One row of the decisions ledger: a made choice, or a considered-and-rejected alternative. */
export interface Decision {
  choice: string
  why: string
  rejected: boolean
}

/**
 * The decisions ledger (#431): every architect decision in the order made (a later
 * re-architect of the same choice supersedes the earlier one), then the latest plan's
 * rejected alternatives. Empty until the architect has run.
 */
export function decisionLedger(events: readonly FrameworkEvent[]): Decision[] {
  const made = new Map<string, string>() // choice -> why, insertion-ordered, last write wins the reason
  for (const event of events) {
    if (event.kind !== 'bootstrap' || event.event.type !== 'architect') continue
    for (const d of event.event.decisions) {
      made.delete(d.choice)
      made.set(d.choice, d.why)
    }
  }
  const decisions: Decision[] = [...made].map(([choice, why]) => ({ choice, why, rejected: false }))
  const plan = architectPlan(events)
  for (const alt of plan?.alternatives ?? []) decisions.push({ choice: alt.option, why: alt.whyNot, rejected: true })
  return decisions
}

/** The production-grade loop status (#431): the current pass, whether it passed, and any blockers. */
export interface LoopStatus {
  pass: number
  passing: boolean
  blockers: string[]
  /** True once the run reached production-grade (the loop ended with no blockers). */
  productionGrade: boolean
  /** True once a `done` bootstrap event has fired (the loop is over). */
  finished: boolean
}

/**
 * The latest checklist verdict (#431), from the `checklist`/`improve`/`done` bootstrap
 * events. Null until a checklist has run (a prototype build never loops). `done` closes
 * it out with the final production-grade verdict.
 */
export function loopStatus(events: readonly FrameworkEvent[]): LoopStatus | null {
  let status: LoopStatus | null = null
  for (const event of events) {
    if (event.kind !== 'bootstrap') continue
    const e = event.event
    if (e.type === 'checklist') {
      status = { pass: e.pass, passing: e.passing, blockers: [...e.blockers], productionGrade: e.passing, finished: false }
    } else if (e.type === 'improve') {
      status = { pass: e.pass, passing: false, blockers: [...e.blockers], productionGrade: false, finished: false }
    } else if (e.type === 'done') {
      const r = e.result
      status = {
        pass: r.passes,
        passing: r.productionGrade,
        blockers: [...r.blockers],
        productionGrade: r.productionGrade,
        finished: true,
      }
    }
  }
  return status
}

/** The chosen deploy plan (#433): how the app renders and where it lands, from the `deploy` bootstrap event. */
export interface DeployPlan {
  render: 'ssr' | 'ssg' | 'spa'
  target: string
  reason: string
}

/** The deploy plan the run decided on, or null before the deploy phase ran. Latest wins. */
export function deployPlan(events: readonly FrameworkEvent[]): DeployPlan | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind !== 'bootstrap' || event.event.type !== 'deploy') continue
    const p = event.event.plan
    return { render: p.render, target: p.target, reason: p.reason }
  }
  return null
}

/** The wrapped agent session (#431): its id and a deep link, when one is known. */
export interface SessionInfo {
  driver?: string
  fake?: boolean
  sessionId?: string
  sessionLink?: string
}

/**
 * The session behind the run (#431): the driver + workspace from the opening `session`
 * event, then the id and any deep link from the latest `session-update`. Null before the
 * session opens. The link is what the old dashboard surfaced as "open session".
 */
export function sessionInfo(events: readonly FrameworkEvent[]): SessionInfo | null {
  let info: SessionInfo | null = null
  for (const event of events) {
    if (event.kind === 'session') {
      info = { driver: event.driver, fake: event.fake, ...(event.sessionLink ? { sessionLink: event.sessionLink } : {}) }
    } else if (event.kind === 'session-update') {
      info = { ...(info ?? {}), sessionId: event.sessionId, ...(event.sessionLink ? { sessionLink: event.sessionLink } : {}) }
    }
  }
  return info
}
