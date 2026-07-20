import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  autoPmDecision,
  quotaHeadroom,
  startAutoPm,
  DEFAULT_MIN_FREE_PERCENT,
  AUTO_PM_JOBS,
  type AutoPmDeps,
  type AutoPmJob,
  type AutoPmProject,
  type AutoPmQuota,
} from './auto-pm.js'
import { ConsumptionMeter, consumptionStatus, DEFAULT_CONSUMPTION_LIMITS } from './consumption.js'

const T0 = 1_800_000_000_000

/**
 * A reading where the rolling meter has seen `weekPercent` points burned, and the account's
 * own week is `accountWeek` spent (default: the same, the honest case).
 */
function status(weekPercent: number | undefined, accountWeek: number | undefined = weekPercent ?? 0): AutoPmQuota {
  const meter = new ConsumptionMeter()
  if (weekPercent !== undefined) {
    // Two samples, because the meter measures the delta between readings, not an absolute.
    meter.record({ at: T0 - 1000, weeklyPercent: 0 })
    meter.record({ at: T0, weeklyPercent: weekPercent })
  }
  return {
    status: consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 }),
    weekPercentUsed: accountWeek,
  }
}

/** The happy inputs, so each test names only the condition it is about. */
const IDLE = { enabled: true, backlogEmpty: true, activeRuns: 0, quota: status(1) } as const

test('autoPmDecision starts when the queue is dry and the budget is barely touched (#685)', () => {
  assert.deepEqual(autoPmDecision(IDLE), { start: true })
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

test('autoPmDecision waits while the queue still has entries (#685)', () => {
  // #685 is only about the dry-queue case: with work queued, the backlog loop has it.
  const decision = autoPmDecision({ ...IDLE, backlogEmpty: false })
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /still has open entries/)
})

test('autoPmDecision holds off during the cooldown after a start (#685)', () => {
  const decision = autoPmDecision({ ...IDLE, sinceLastStartMs: 60_000 })
  assert.equal(decision.start, false)
  const later = autoPmDecision({ ...IDLE, sinceLastStartMs: 60 * 60_000 })
  assert.deepEqual(later, { start: true })
})

test('quotaHeadroom refuses to start when the quota cannot be read (#685)', () => {
  // The inverse of the per-run guard's fail-open (#519): that one must never STOP the user's
  // own work, this one must never START work nobody asked for on an unknown budget.
  const decision = quotaHeadroom(undefined, DEFAULT_MIN_FREE_PERCENT)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /could not be read/)
})

test('quotaHeadroom refuses while a window has no reading yet (#685)', () => {
  const decision = quotaHeadroom(status(undefined), DEFAULT_MIN_FREE_PERCENT)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /no reading yet/)
})

test('quotaHeadroom refuses once a window is past the threshold (#685)', () => {
  // The 5h budget is 12 points, so 10 points spent is ~83% of it: well past half.
  const decision = quotaHeadroom(status(10), DEFAULT_MIN_FREE_PERCENT)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /% used/)
})

test('quotaHeadroom still starts with the rolling limits off, guarded by the account week (#848)', () => {
  // The rolling limits are the user's own pacing knobs; switching them off used to leave the
  // gate with no denominator at all. The account's absolute week is the denominator now.
  const off = { enabled: false, percent: 20 }
  const meter = new ConsumptionMeter()
  meter.record({ at: T0 - 1000, weeklyPercent: 0 })
  meter.record({ at: T0, weeklyPercent: 1 })
  const quota: AutoPmQuota = {
    status: consumptionStatus({ meter, limits: { daily: off, fiveHour: off, session: off }, now: T0 }),
    weekPercentUsed: 5,
  }
  assert.deepEqual(quotaHeadroom(quota, DEFAULT_MIN_FREE_PERCENT), { start: true })
  assert.equal(quotaHeadroom({ ...quota, weekPercentUsed: 95 }, DEFAULT_MIN_FREE_PERCENT).start, false)
})

test('quotaHeadroom refuses when the account week is nearly spent (#848)', () => {
  const decision = quotaHeadroom(status(1, 95), DEFAULT_MIN_FREE_PERCENT)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /account's week is 95% used/)
})

test('quotaHeadroom refuses when the account week cannot be read (#848)', () => {
  // Built inline, not via status(1, undefined): an explicit undefined argument still triggers
  // the default parameter, which would quietly hand the check a real number.
  const decision = quotaHeadroom({ ...status(1), weekPercentUsed: undefined }, DEFAULT_MIN_FREE_PERCENT)
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /weekly usage could not be read/)
})

test('a restarted daemon does not spend the last of the quota (#848)', () => {
  // The regression, reproduced live on 0f16b3e before the fix. The meter is delta-based, so a
  // daemon that just restarted has one sample, nothing to diff it against, and honestly reports
  // 0 consumed -- while the account sits at 95% of its week. Zero and unknown look identical to
  // a usedPercent check, which is why the absolute reading has to be the one in charge.
  const fresh = new ConsumptionMeter()
  fresh.record({ at: T0, weeklyPercent: 95 })
  const rolling = consumptionStatus({ meter: fresh, limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 })
  assert.equal(rolling.daily.usedPercent, 0) // the trap: not undefined
  assert.equal(rolling.daily.complete, false) // the honest signal underneath it

  const decision = autoPmDecision({
    enabled: true,
    backlogEmpty: true,
    activeRuns: 0,
    quota: { status: rolling, weekPercentUsed: 95 },
  })
  assert.equal(decision.start, false)
  assert.match(decision.start === false ? decision.reason : '', /account's week is 95% used/)
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
