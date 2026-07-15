import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { startConsumptionGuard } from './consumption-guard.js'
import { DEFAULT_CONSUMPTION_LIMITS } from './consumption.js'
import { FakeDriver } from './driver/index.js'
import type { Driver, DriverQuota } from './driver/index.js'

const T0 = 1_800_000_000_000

function quotaDriver(...readings: DriverQuota[]): Driver {
  let i = 0
  return {
    name: 'quota-fake',
    start: () => Promise.reject(new Error('not used')),
    readQuota: () => Promise.resolve(readings[Math.min(i++, readings.length - 1)] as DriverQuota),
  }
}

function week(percentUsed: number): DriverQuota {
  return { available: true, windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed }] }
}

test('startConsumptionGuard leaves a driver that cannot report a quota ungated (#531)', () => {
  // The fake driver has no readQuota, so there is nothing to guard with. Fail
  // open: no reading must never mean "stop the work".
  assert.equal(startConsumptionGuard({ driver: new FakeDriver(), limits: DEFAULT_CONSUMPTION_LIMITS }), undefined)
})

test('startConsumptionGuard gate says carry on before the first reading lands (#531)', () => {
  const guard = startConsumptionGuard({ driver: quotaDriver(week(5)), limits: DEFAULT_CONSUMPTION_LIMITS, now: () => T0 })
  assert.ok(guard)
  // start() polls without awaiting, so nothing is measurable yet.
  assert.equal(guard.gate(), null)
  guard.stop()
})

test('startConsumptionGuard gate pauses once the session has spent its budget (#531)', async () => {
  let at = T0
  // 5% of the week at the baseline, 14% a moment later: 9 points this session,
  // past the session budget of 8.
  const guard = startConsumptionGuard({
    driver: quotaDriver(week(5), week(14)),
    limits: DEFAULT_CONSUMPTION_LIMITS,
    sessionStartedAt: T0,
    now: () => at,
  })
  assert.ok(guard)
  // start() takes the baseline reading itself; let it land.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(guard.gate(), null)
  at = T0 + 60_000
  await guard.poller.poll()
  assert.equal(guard.gate(), 'session')
  guard.stop()
})

test('startConsumptionGuard gate carries on when the quota cannot be read (#531)', async () => {
  const guard = startConsumptionGuard({
    driver: quotaDriver({ available: false, reason: 'fetch-failed' }),
    limits: DEFAULT_CONSUMPTION_LIMITS,
    now: () => T0,
  })
  assert.ok(guard)
  await guard.poller.poll()
  assert.equal(guard.gate(), null)
  guard.stop()
})

test('startConsumptionGuard stop ends the polling (#531)', () => {
  const guard = startConsumptionGuard({ driver: quotaDriver(week(5)), limits: DEFAULT_CONSUMPTION_LIMITS, now: () => T0 })
  assert.ok(guard)
  guard.stop()
  assert.equal(guard.poller.isStopped, true)
})

test('startConsumptionGuard reads the quota straight away rather than an interval later (#531)', async () => {
  let reads = 0
  const driver: Driver = {
    name: 'counting',
    start: () => Promise.reject(new Error('not used')),
    readQuota: () => {
      reads++
      return Promise.resolve(week(5))
    },
  }
  const guard = startConsumptionGuard({ driver, limits: DEFAULT_CONSUMPTION_LIMITS, now: () => T0 })
  // The session's own measurement needs a baseline from the moment it started,
  // so waiting a full poll interval for the first reading would be no use.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  guard?.stop()
})
