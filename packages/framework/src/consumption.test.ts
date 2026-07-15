import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  ConsumptionMeter,
  DEFAULT_CONSUMPTION_LIMITS,
  FIVE_HOURS_MS,
  ONE_DAY_MS,
  budgetsFrom,
  consumptionStatus,
  type ConsumptionLimits,
} from './consumption.js'

const T0 = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function meterOf(...samples: [hoursAgo: number, weeklyPercent: number][]): ConsumptionMeter {
  const meter = new ConsumptionMeter()
  for (const [hoursAgo, weeklyPercent] of samples) meter.record({ at: T0 - hoursAgo * HOUR, weeklyPercent })
  return meter
}

test("budgetsFrom resolves Rom's chain into weekly-meter points (#523)", () => {
  // A day is 20% of the week; a 5h stretch 60% of that day; a session 40% of it.
  assert.deepEqual(budgetsFrom(DEFAULT_CONSUMPTION_LIMITS), { daily: 20, fiveHour: 12, session: 8 })
})

test('budgetsFrom rescales the shorter limits when the day changes (#523)', () => {
  const limits: ConsumptionLimits = {
    daily: { enabled: true, percent: 50 },
    fiveHour: { enabled: true, percent: 60 },
    session: { enabled: true, percent: 40 },
  }
  assert.deepEqual(budgetsFrom(limits), { daily: 50, fiveHour: 30, session: 20 })
})

test('ConsumptionMeter measures what was spent across a window (#523)', () => {
  const meter = meterOf([10, 10], [5, 14], [0, 20])
  const rolling = meter.rolling(ONE_DAY_MS, T0)
  assert.equal(rolling?.points, 10)
  assert.equal(rolling?.complete, false) // only 10h of samples for a 24h window
})

test('ConsumptionMeter counts only the requested window, not everything it holds (#523)', () => {
  const meter = meterOf([10, 10], [5, 14], [0, 20])
  // The 5h window starts at the sample reading 14, so only 6 points are inside it.
  assert.equal(meter.rolling(FIVE_HOURS_MS, T0)?.points, 6)
})

test('ConsumptionMeter reports the weekly reset as spend since the reset, not a negative (#523)', () => {
  // The meter drops at the week boundary: 90 -> 3 means 3 points spent since it reset.
  const meter = meterOf([6, 88], [4, 90], [2, 3], [0, 5])
  const rolling = meter.rolling(ONE_DAY_MS, T0)
  // 88->90 is 2, the reset segment contributes its 3 outright, then 3->5 is 2.
  assert.equal(rolling?.points, 7)
  assert.ok((rolling?.points ?? -1) >= 0)
})

test('ConsumptionMeter says how much of the window it can vouch for (#523)', () => {
  const complete = meterOf([30, 0], [24, 5], [0, 9])
  const rolling = complete.rolling(ONE_DAY_MS, T0)
  assert.equal(rolling?.complete, true)
  assert.equal(rolling?.coveredMs, ONE_DAY_MS)

  // Daemon was down until 6h ago: a "24h" figure really only covers 6h.
  const partial = meterOf([6, 5], [0, 9])
  const short = partial.rolling(ONE_DAY_MS, T0)
  assert.equal(short?.complete, false)
  assert.equal(short?.coveredMs, 6 * HOUR)
  assert.equal(short?.points, 4)
})

test('ConsumptionMeter reports no reading as unknown, never as zero (#523)', () => {
  // Zero would read as "nothing spent" and leave every limit unreachable.
  assert.equal(new ConsumptionMeter().rolling(ONE_DAY_MS, T0), undefined)
})

test('ConsumptionMeter measures a session from when it started (#523)', () => {
  const meter = meterOf([8, 10], [3, 12], [0, 18])
  assert.equal(meter.since(T0 - 3 * HOUR, T0)?.points, 6)
})

test('ConsumptionMeter ignores an out-of-order reading (#523)', () => {
  const meter = new ConsumptionMeter()
  meter.record({ at: T0, weeklyPercent: 10 })
  // A late arrival would look like a weekly reset and inflate consumption.
  meter.record({ at: T0 - HOUR, weeklyPercent: 4 })
  assert.equal(meter.size, 1)
})

test('ConsumptionMeter.prune keeps the sample the widest window measures from (#523)', () => {
  const meter = meterOf([40, 1], [26, 2], [20, 4], [0, 9])
  meter.prune(T0, ONE_DAY_MS)
  // The 26h-old sample is the baseline for a 24h window, so it has to survive.
  assert.equal(meter.rolling(ONE_DAY_MS, T0)?.complete, true)
  assert.equal(meter.rolling(ONE_DAY_MS, T0)?.points, 7)
  assert.equal(meter.size, 3)
})

test('consumptionStatus fills each bar against its own budget (#523)', () => {
  // 4 points spent in the last 5h, all of it this session.
  const meter = meterOf([6, 10], [4, 10], [0, 14])
  const status = consumptionStatus({
    meter,
    limits: DEFAULT_CONSUMPTION_LIMITS,
    sessionStartedAt: T0 - 4 * HOUR,
    now: T0,
  })
  assert.equal(status.daily.consumed, 4)
  assert.equal(status.daily.usedPercent, 20) // 4 of 20 points
  assert.equal(status.fiveHour.usedPercent, (4 / 12) * 100)
  assert.equal(status.session.usedPercent, 50) // 4 of 8 points
  assert.equal(status.reached, null)
})

test('consumptionStatus pauses for the session limit once it is spent (#523)', () => {
  const meter = meterOf([2, 10], [0, 18]) // 8 points this session = the whole session budget
  const status = consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, sessionStartedAt: T0 - 2 * HOUR, now: T0 })
  assert.equal(status.session.reached, true)
  assert.equal(status.reached, 'session')
})

test('consumptionStatus surfaces the widest limit when several are spent (#523)', () => {
  // 22 points in 2h: past the day's 20, the 5h's 12 and the session's 8.
  const meter = meterOf([2, 10], [0, 32])
  const status = consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, sessionStartedAt: T0 - 2 * HOUR, now: T0 })
  assert.equal(status.daily.reached, true)
  assert.equal(status.fiveHour.reached, true)
  assert.equal(status.session.reached, true)
  // Daily takes the longest to recover, so it's the one to report.
  assert.equal(status.reached, 'daily')
})

test('consumptionStatus ignores a disabled limit (#523)', () => {
  const meter = meterOf([2, 10], [0, 32])
  const limits: ConsumptionLimits = {
    ...DEFAULT_CONSUMPTION_LIMITS,
    daily: { enabled: false, percent: 20 },
    fiveHour: { enabled: false, percent: 60 },
  }
  const status = consumptionStatus({ meter, limits, sessionStartedAt: T0 - 2 * HOUR, now: T0 })
  assert.equal(status.daily.reached, false)
  // Still measured, so its bar can be drawn while the limit is off.
  assert.equal(status.daily.consumed, 22)
  assert.equal(status.reached, 'session')
})

test('consumptionStatus never pauses on a quota it could not read (#523)', () => {
  // Fail-open: a reworded readout must not stop the user's work.
  const status = consumptionStatus({ meter: new ConsumptionMeter(), limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 })
  assert.equal(status.reached, null)
  assert.equal(status.daily.consumed, undefined)
  assert.equal(status.daily.usedPercent, undefined)
})

test('consumptionStatus leaves the session bar unmeasured when nothing is running (#523)', () => {
  const meter = meterOf([2, 10], [0, 14])
  const status = consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, now: T0 })
  assert.equal(status.session.consumed, undefined)
  assert.equal(status.session.reached, false)
  assert.equal(status.daily.consumed, 4)
})

test('consumptionStatus keeps a full bar at 100 rather than overflowing it (#523)', () => {
  const meter = meterOf([1, 0], [0, 40])
  const status = consumptionStatus({ meter, limits: DEFAULT_CONSUMPTION_LIMITS, sessionStartedAt: T0 - HOUR, now: T0 })
  assert.equal(status.daily.usedPercent, 100)
  assert.equal(status.session.usedPercent, 100)
})
