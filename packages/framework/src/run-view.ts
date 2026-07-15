import type { FrameworkEvent } from './events.js'

// Derived run state for the dashboard's overview cards (#431): the production-grade
// loop status, the deploy plan, and the live session link — each a pure projection of
// the same FrameworkEvent stream the log renders, so the live dashboard and a past-run
// replay show the identical summary. Kept here (not in the dashboard) so it is
// unit-tested against the real event shapes. The bootstrap phase (checklist/deploy)
// carries the structured data; we surface it as cards.

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

/** The run's lifecycle progress (#326): the session name it chose and whether it is ready for merge. */
export interface RunProgress {
  /** The `[a-z0-9-]` session name (also the branch), once the agent set one via `setSessionName()`. */
  sessionName?: string
  /** True once the agent signalled `setReadyForMerge()`: building (false) -> ready (true). */
  readyForMerge: boolean
}

/**
 * The run's lifecycle progress (#326): the latest `session-name` the agent set and whether
 * a `ready-for-merge` has fired. Drives the dashboard status label + dot (orange building,
 * green ready). Always returns a value — an untouched run is `{ readyForMerge: false }`.
 */
export function runProgress(events: readonly FrameworkEvent[]): RunProgress {
  const progress: RunProgress = { readyForMerge: false }
  for (const event of events) {
    if (event.kind === 'session-name') progress.sessionName = event.name
    else if (event.kind === 'ready-for-merge') progress.readyForMerge = true
  }
  return progress
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
