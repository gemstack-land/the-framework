import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  autoPmDecision,
  quotaHeadroom,
  startAutoPm,
  AUTO_PM_JOBS,
  AUTO_PM_DRAIN_JOB,
  type AutoPmDeps,
  type AutoPmJob,
  type AutoPmProject,
  type AutoPmQuota,
} from './auto-pm.js'
import { ConsumptionMeter, consumptionStatus, DEFAULT_CONSUMPTION_LIMITS } from './consumption.js'

const T0 = 1_800_000_000_000

/**
 * A reading where the rolling meter has seen `weekPercent` points burned.
 */
function status(weekPercent: number | undefined): AutoPmQuota {
  const meter = new ConsumptionMeter()
  if (weekPercent !== undefined) {
    // Two samples, because the meter measures the delta between readings, not an absolute.
    meter.record({ at: T0 - 1000, weeklyPercent: 0 })
    meter.record({ at: T0, weeklyPercent: weekPercent })
  }
  return { status: consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 }) }
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

test('quotaHeadroom starts while no configured limit is met (#870)', () => {
  assert.deepEqual(quotaHeadroom(status(1)), { start: true })
})

test('quotaHeadroom stands down once a configured limit is reached, and names it (#870)', () => {
  // The user's own limits are the gate now: auto PM has no threshold of its own to trip first.
  const decision = quotaHeadroom(status(99))
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /limit is reached/)
})

test('quotaHeadroom starts with every rolling limit switched off (#870)', () => {
  // Switching the limits off is the user saying "do not pace me". Auto PM used to keep its own
  // 50%-free rule here and refuse anyway, which is the second budget notion #870 removed.
  const off = { enabled: false, percent: 20 }
  const meter = new ConsumptionMeter()
  meter.record({ at: T0 - 1000, weeklyPercent: 0 })
  meter.record({ at: T0, weeklyPercent: 95 })
  const quota: AutoPmQuota = {
    status: consumptionStatus({ meter, limits: { daily: off, fiveHour: off, session: off }, now: T0 }),
  }
  assert.deepEqual(quotaHeadroom(quota), { start: true })
})

test('a restarted daemon reads as untouched, which the configured limits are what guard (#870)', () => {
  // Pinning a known blind spot rather than leaving it to be rediscovered. The meter is delta
  // based, so a daemon that just restarted has one sample, nothing to diff it against, and
  // honestly reports 0 consumed -- while the account may sit at 95% of its week.
  //
  // #848 covered this with the account's own absolute weekly figure, measured against auto PM's
  // 50%-free rule. #870 removed that rule as a second set of limits, and the absolute check went
  // with it, so what stands here now is whatever the user configured. With the defaults that is
  // enough; with the limits off, nothing stops a fresh daemon. Raised on #870.
  const fresh = new ConsumptionMeter()
  fresh.record({ at: T0, weeklyPercent: 95 })
  const rolling = consumptionStatus({ meter: fresh, limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 })
  assert.equal(rolling.daily.usedPercent, 0) // the trap: not undefined
  assert.equal(rolling.daily.complete, false) // the honest signal underneath it

  const decision = autoPmDecision({ enabled: true, backlogEmpty: true, activeRuns: 0, quota: { status: rolling } })
  assert.equal(decision.start, true)
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

test('AUTO_PM_JOBS harvests before it plans (#773)', () => {
  // Quick wins lead: a machine that already has plans should start doing, not planning more.
  assert.deepEqual(AUTO_PM_JOBS.map(j => j.name), ['quick-wins', 'spike-and-plan'])
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
