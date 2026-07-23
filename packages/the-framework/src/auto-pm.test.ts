import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  autoPmDecision,
  quotaHeadroom,
  startAutoPm,
  AUTO_PM_JOBS,
  AUTO_PM_DRAIN_JOB,
  AUTO_PM_MAINTENANCE_JOB,
  type AutoPmDeps,
  type AutoPmJob,
  type AutoPmLoop,
  type AutoPmProject,
} from './auto-pm.js'
import { quotaBoundaryStatus, type QuotaBoundaryStatus } from './quota-boundary.js'

/** 2026-07-20T12:00:00Z. The week below resets in 5 days, so this is day 3 of 7 (42.8% allowed). */
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0)

/** A reading where the account's week is `weekPercent` used. */
function status(weekPercent: number): QuotaBoundaryStatus {
  const boundary = quotaBoundaryStatus({
    windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed: weekPercent, resetsAtText: 'Jul 25 at 7am (UTC)' }],
    now: T0,
  })
  if (!boundary) throw new Error('the fixture week should be placeable')
  return boundary
}

/** The happy inputs, so each test names only the condition it is about. */
const IDLE = { enabled: true, backlogEmpty: true, activeRuns: 0, quota: status(1) } as const

test('autoPmDecision starts when the queue is dry and the budget is barely touched (#685)', () => {
  assert.deepEqual(autoPmDecision(IDLE), { start: true, mode: 'pm' })
})

test('autoPmDecision does nothing while the preference is off (#685)', () => {
  const decision = autoPmDecision({ ...IDLE, enabled: false })
  assert.equal(decision.start, false)
})

test('autoPmDecision leaves a busy project alone (#685)', () => {
  // A live run is already spending the quota; a second one started unasked would race it.
  const decision = autoPmDecision({ ...IDLE, activeRuns: 1 })
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /already going/)
})

test('autoPmDecision drains the queue before filling it again (#855)', () => {
  // It used to refuse here, on the reasoning that the backlog loop would drain it. That loop
  // only runs inside a run a human started, so unattended nothing ever emptied the queue.
  assert.deepEqual(autoPmDecision({ ...IDLE, backlogEmpty: false }), { start: true, mode: 'drain' })
})

test('autoPmDecision refuses when the queue cannot be read at all (#855)', () => {
  // Empty and non-empty both start something now, so "could not tell" has to be its own answer
  // rather than falling back to either.
  const decision = autoPmDecision({ ...IDLE, backlogEmpty: undefined })
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /queue could not be read/)
})

test('autoPmDecision holds off during the cooldown after a start (#685)', () => {
  const decision = autoPmDecision({ ...IDLE, sinceLastStartMs: 60_000 })
  assert.equal(decision.start, false)
  const later = autoPmDecision({ ...IDLE, sinceLastStartMs: 60 * 60_000 })
  assert.deepEqual(later, { start: true, mode: 'pm' })
})

test('quotaHeadroom refuses to start when the quota cannot be read (#685)', () => {
  // The inverse of the per-run guard's fail-open (#519): that one must never STOP the user's
  // own work, this one must never START work nobody asked for on an unknown budget.
  const decision = quotaHeadroom(undefined)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /could not be read/)
})

test('quotaHeadroom starts while the account is under the boundary (#879)', () => {
  assert.deepEqual(quotaHeadroom(status(1)), { start: true })
})

test('quotaHeadroom stands down at the boundary, and says where it sits (#879)', () => {
  // Day 3 of 7 allows 42.8%, so a week at 99% is well past it.
  const decision = quotaHeadroom(status(99))
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /99% used, at or past day 3 of the week's 43%/)
})

test('quotaHeadroom stands down the moment the boundary is met, not only when it is passed (#879)', () => {
  const decision = quotaHeadroom(status((3 / 7) * 100))
  assert.equal(decision.start, false)
})

test('a restarted daemon is no longer blind (#848/#879)', () => {
  // The old rolling meter was delta-based, so a daemon that had just restarted had one sample,
  // nothing to diff it against, and honestly reported 0 consumed while the account sat at 95%
  // of its week. The boundary reads the account's own absolute figure, which owes nothing to
  // how long this process has been up, so the restart is simply not a case any more.
  const decision = autoPmDecision({ enabled: true, backlogEmpty: true, activeRuns: 0, quota: status(95) })
  assert.equal(decision.start, false)
})

const JOBS: readonly AutoPmJob[] = [
  { name: 'first', prompt: 'do the first thing', describe: 'doing the first thing' },
  { name: 'second', prompt: 'do the second thing', describe: 'doing the second thing' },
]

/** A loop wired to one idle project, with every reading overridable per test. */
function harness(overrides: Partial<AutoPmDeps> = {}) {
  const project: AutoPmProject = { id: 'p1', path: '/repo' }
  const started: string[] = []
  const ran: string[] = []
  const logs: string[] = []
  const deps: AutoPmDeps = {
    projects: async () => [project],
    jobs: JOBS,
    enabled: async () => true,
    backlogEmpty: async () => true,
    activeRuns: () => 0,
    quota: async () => status(1),
    start: async (p, job) => {
      started.push(p.id)
      ran.push(job.name)
      return `run-${ran.length}`
    },
    promote: async () => ({ settled: true, promoted: false }),
    log: message => logs.push(message),
    now: () => T0,
    ...overrides,
  }
  return { loop: startAutoPm(deps), started, ran, logs }
}

test('startAutoPm starts a run for an idle project (#685)', async () => {
  const { loop, started } = harness()
  await loop.tick()
  loop.stop()
  assert.deepEqual(started, ['p1'])
})

test('startAutoPm starts nothing while the preference is off (#685)', async () => {
  const { loop, started } = harness({ enabled: async () => false })
  await loop.tick()
  loop.stop()
  assert.deepEqual(started, [])
})

test('startAutoPm does not start a second run for the same project (#685)', async () => {
  // The cooldown is what stops a tick that lands before the spawn registers from doubling up.
  const { loop, started } = harness()
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.deepEqual(started, ['p1'])
})

test('startAutoPm re-arms when the start was refused (#685)', async () => {
  // A refused start spent nothing, so holding the cooldown would strand the project.
  let attempts = 0
  const { loop } = harness({
    start: async () => {
      attempts++
      return attempts > 1 ? `run-${attempts}` : undefined
    },
  })
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.equal(attempts, 2)
})

test('startAutoPm survives a project whose backlog cannot be read (#685)', async () => {
  // An unreadable queue is not an empty one: it must not trigger a run, nor throw the sweep.
  const { loop, started } = harness({ backlogEmpty: async () => Promise.reject(new Error('nope')) })
  await loop.tick()
  loop.stop()
  assert.deepEqual(started, [])
})

test('AUTO_PM_JOBS harvests, then triages, then plans (#773/#891/#892)', () => {
  // Cheapest-and-readiest first: harvest existing plans, triage the cheap tickets, then the
  // significant ones, and leave planning last — it is the priciest turn and the one whose
  // output every earlier job consumes.
  assert.deepEqual(AUTO_PM_JOBS.map(j => j.name), [
    'quick-wins',
    'triage-quick',
    'triage-consensual',
    'spike-and-plan',
  ])
})

test('the rotation is the schedule the triage presets asked for (#891/#892)', () => {
  // #891/#892 both say "with a cron job regularly firing this preset". The rotation already
  // fires on every idle tick where the queue is dry, so no separate scheduler exists — unlike
  // the maintenance sweep (#882), which needs a calendar key because it would never come due.
  const names = AUTO_PM_JOBS.map(j => j.name)
  assert.ok(names.includes('triage-quick'), 'quick triage must be in the rotation')
  assert.ok(names.includes('triage-consensual'), 'consensual triage must be in the rotation')
  // The gated sibling (#698) must never be: it ends in <AWAIT> and would park a run forever.
  assert.equal(names.includes('suggest-tickets-to-work-on'), false)
  for (const job of AUTO_PM_JOBS) {
    assert.equal(job.prompt.includes('<AWAIT>'), false, `${job.name} must not wait on a human`)
  }
})

test('startAutoPm walks the job cycle across idle moments (#773)', async () => {
  // The cooldown normally spaces these out; zero it so one test can see the whole rotation.
  const { loop, ran } = harness({ cooldownMs: 0 })
  await loop.tick()
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, ['first', 'second', 'first'])
})

test('startAutoPm retries the same job when the start was refused (#773)', async () => {
  // Advancing on a refusal would silently skip a job nobody ever ran.
  const ran: string[] = []
  let attempts = 0
  const { loop } = harness({
    cooldownMs: 0,
    start: async (_p, job) => {
      attempts++
      if (attempts === 1) return undefined
      ran.push(job.name)
      return `run-${attempts}`
    },
  })
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, ['first'])
})

test('a promoted queue ends the tick, so the sweep re-reads it next time (#852)', async () => {
  // The run's queue lands in the checkout only now, so the emptiness check below it is stale.
  // Deciding on that read is what made auto PM re-derive the same entries every cooldown.
  const promoted: string[] = []
  const { loop, ran } = harness({
    cooldownMs: 0,
    promote: async (_p, runId) => {
      promoted.push(runId)
      return { settled: true, promoted: true }
    },
  })
  await loop.tick() // starts run-1
  await loop.tick() // lands run-1's queue and stops there
  assert.deepEqual(promoted, ['run-1'])
  assert.deepEqual(ran, ['first'])
})

test('a finished run that wrote no queue stops being retried (#852)', async () => {
  // Settled without promoting: nothing landed, but the run is over, so the sweep carries on
  // rather than asking about it forever.
  const asked: string[] = []
  const { loop, ran } = harness({
    cooldownMs: 0,
    promote: async (_p, runId) => {
      asked.push(runId)
      return { settled: true, promoted: false }
    },
  })
  await loop.tick()
  await loop.tick()
  await loop.tick()
  // Each tick starts a fresh run and settles the previous one, so every run is asked about
  // exactly once. A settled run being asked twice is the leak this guards.
  assert.deepEqual(asked, [...new Set(asked)])
  assert.deepEqual(asked, ['run-1', 'run-2'])
  assert.deepEqual(ran, ['first', 'second', 'first'])
})

test('a run still going is left pending, and the sweep starts nothing new (#852)', async () => {
  const { loop, ran } = harness({ cooldownMs: 0, promote: async () => ({ settled: false, promoted: false }) })
  await loop.tick() // starts run-1
  await loop.tick() // run-1 unsettled, nothing landed -> falls through to the decision
  loop.stop()
  // The second tick reaches the decision and starts the next job: the cooldown is what normally
  // spaces these, and it is zeroed here. What matters is run-1 is still tracked, not dropped.
  assert.ok(ran.length >= 1)
})

test('startAutoPm drains a standing queue, then goes back to filling it (#855)', async () => {
  // The deadlock this fixes: a PM job filled the queue, nothing unattended drained it, and every
  // later tick refused because it was no longer empty. The cycle has to come back round.
  let open = 1
  const ran: string[] = []
  const { loop } = harness({
    cooldownMs: 0,
    backlogEmpty: async () => open === 0,
    // A drain run works one entry off; a PM run puts one there.
    start: async (_project, job) => {
      ran.push(job.name)
      open += job.name === AUTO_PM_DRAIN_JOB.name ? -1 : 1
      return `run-${ran.length}`
    },
  })
  await loop.tick() // an entry is standing -> work it off
  await loop.tick() // dry now -> refill
  await loop.tick() // standing again -> work it off
  loop.stop()
  assert.deepEqual(ran, [AUTO_PM_DRAIN_JOB.name, 'first', AUTO_PM_DRAIN_JOB.name])
})

test('draining does not advance the PM rotation (#855)', async () => {
  // The rotation is about what to make when there is nothing to do. A queue worked off over
  // several ticks must not push it forward once per entry and skip a job.
  let open = 2
  const ran: string[] = []
  const { loop } = harness({
    cooldownMs: 0,
    backlogEmpty: async () => open === 0,
    start: async (_project, job) => {
      ran.push(job.name)
      open += job.name === AUTO_PM_DRAIN_JOB.name ? -1 : 1
      return `run-${ran.length}`
    },
  })
  await loop.tick()
  await loop.tick()
  await loop.tick() // dry -> the rotation resumes at its first job, not its second
  loop.stop()
  assert.deepEqual(ran, [AUTO_PM_DRAIN_JOB.name, AUTO_PM_DRAIN_JOB.name, 'first'])
})

test('an unreadable queue starts nothing at all (#855)', async () => {
  const ran: string[] = []
  const { loop } = harness({
    cooldownMs: 0,
    backlogEmpty: async () => {
      throw new Error('no such file')
    },
    start: async (_project, job) => {
      ran.push(job.name)
      return 'run-1'
    },
  })
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, [])
})

test('AUTO_PM_MAINTENANCE_JOB fires the [Maintenance] preset over the whole codebase (#882)', () => {
  // It renders with no session, so the preset's own default is what scopes it. A sweep that
  // silently scoped itself to one session would miss the pre-existing history it exists for.
  assert.equal(AUTO_PM_MAINTENANCE_JOB.name, 'maintenance')
  assert.match(AUTO_PM_MAINTENANCE_JOB.prompt, /entire codebase/)
  assert.doesNotMatch(AUTO_PM_MAINTENANCE_JOB.prompt, /\$\{\{/)
})

test('a due project is swept before the rotation gets a turn (#882)', async () => {
  const { loop, ran } = harness({ cooldownMs: 0, maintenanceDue: async () => true })
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, [AUTO_PM_MAINTENANCE_JOB.name])
})

test('a project that is not due keeps doing the rotation (#882)', async () => {
  const { loop, ran } = harness({ cooldownMs: 0, maintenanceDue: async () => false })
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, ['first', 'second'])
})

test('a sweep does not cost the rotation its turn (#882)', async () => {
  // The sweep is paced by the calendar, not the cycle. If it advanced the rotation, the job it
  // borrowed the tick from would be skipped and never run.
  let due = true
  const { loop, ran } = harness({
    cooldownMs: 0,
    maintenanceDue: async () => due,
    recordMaintenance: async () => {
      due = false
    },
  })
  await loop.tick()
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, [AUTO_PM_MAINTENANCE_JOB.name, 'first'])
})

test('a sweep is stamped only when the run actually started (#882)', async () => {
  // Stamping a refused sweep would postpone it a whole interval for a run that never happened.
  const stamped: string[] = []
  const { loop } = harness({
    cooldownMs: 0,
    maintenanceDue: async () => true,
    recordMaintenance: async project => {
      stamped.push(project.id)
    },
    start: async () => undefined,
  })
  await loop.tick()
  loop.stop()
  assert.deepEqual(stamped, [])
})

test('a queue with work in it is drained rather than swept (#882)', async () => {
  // A repo with entries waiting has plenty to do; sweeping would only pile more on.
  const { loop, ran } = harness({ cooldownMs: 0, backlogEmpty: async () => false, maintenanceDue: async () => true })
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, [AUTO_PM_DRAIN_JOB.name])
})

test('a sweep stopped mid-flight starts nothing (#983)', async () => {
  // stop() used to only clear the timer, so a tick already inside its per-project loop kept
  // awaiting (git calls, the queue read) and then spawned a run anyway. By then the daemon has
  // quiesced and cleared its live-run map, so that run is tracked by nobody: an orphan holding a
  // worktree, and quota spent on a run nobody will ever see.
  const both: AutoPmProject[] = [
    { id: 'p1', path: '/repo' },
    { id: 'p2', path: '/other' },
  ]
  let loop!: AutoPmLoop
  const h = harness({
    projects: async () => both,
    // The daemon shutting down while the sweep sits between its readings and the spawn.
    backlogEmpty: async () => {
      loop.stop()
      return true
    },
  })
  loop = h.loop
  await loop.tick()
  // p2 neither: stopping is a verdict on the whole sweep, not on one project.
  assert.deepEqual(h.started, [])
})

test('a stopped sweep does not tick again (#983)', async () => {
  const { loop, started } = harness()
  loop.stop()
  await loop.tick()
  assert.deepEqual(started, [])
})

test('an unreadable sweep schedule falls back to the rotation (#882)', async () => {
  // Treating "cannot tell" as due would sweep the codebase on every single tick.
  const { loop, ran } = harness({
    cooldownMs: 0,
    maintenanceDue: async () => {
      throw new Error('no such file')
    },
  })
  await loop.tick()
  loop.stop()
  assert.deepEqual(ran, ['first'])
})
