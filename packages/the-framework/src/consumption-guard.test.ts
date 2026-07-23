import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { startConsumptionGuard } from './consumption-guard.js'
import { FakeDriver } from './driver/index.js'
import type { Driver, DriverQuota, DriverQuotaWindow } from './driver/index.js'

/** 2026-07-20T12:00:00Z. The week below resets in 5 days, so this is day 3 of 7 (42.8% allowed). */
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0)

function quotaDriver(...readings: DriverQuota[]): Driver {
  let i = 0
  return {
    name: 'quota-fake',
    start: () => Promise.reject(new Error('not used')),
    readQuota: () => Promise.resolve(readings[Math.min(i++, readings.length - 1)] as DriverQuota),
  }
}

function week(percentUsed: number, ...extra: DriverQuotaWindow[]): DriverQuota {
  return {
    available: true,
    windows: [
      { label: 'Current week (all models)', kind: 'week', percentUsed, resetsAtText: 'Jul 25 at 7am (UTC)' },
      ...extra,
    ],
  }
}

test('startConsumptionGuard leaves a driver that cannot report a quota ungated (#531)', () => {
  // The fake driver has no readQuota, so there is nothing to guard with. Fail
  // open: no reading must never mean "stop the work".
  assert.equal(startConsumptionGuard({ driver: new FakeDriver() }), undefined)
})

test('startConsumptionGuard gate says carry on before the first reading lands (#531)', () => {
  const guard = startConsumptionGuard({ driver: quotaDriver(week(5)), now: () => T0 })
  assert.ok(guard)
  // start() polls without awaiting, so there is nothing to measure yet.
  assert.equal(guard.gate(), null)
  guard.stop()
})

test('startConsumptionGuard gate pauses once the account is past the boundary (#879)', async () => {
  let at = T0
  const guard = startConsumptionGuard({ driver: quotaDriver(week(20), week(60)), now: () => at })
  assert.ok(guard)
  // start() takes the first reading itself; let it land.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(guard.gate(), null)
  at = T0 + 60_000
  await guard.poller.poll()
  assert.equal(guard.gate(), 'Current week (all models)')
  guard.stop()
})

test("startConsumptionGuard brings the run's own model window into the gate (#879)", async () => {
  const fable = { label: 'Current week (Fable)', kind: 'week-model' as const, percentUsed: 90 }
  const onFable = startConsumptionGuard({ driver: quotaDriver(week(10, fable)), model: 'claude-fable-5', now: () => T0 })
  assert.ok(onFable)
  await onFable.poller.poll()
  assert.equal(onFable.gate(), 'Current week (Fable)')
  onFable.stop()

  // A spent Fable week must not stop a run on another model.
  const onSonnet = startConsumptionGuard({ driver: quotaDriver(week(10, fable)), model: 'claude-sonnet-5', now: () => T0 })
  assert.ok(onSonnet)
  await onSonnet.poller.poll()
  assert.equal(onSonnet.gate(), null)
  onSonnet.stop()
})

test('startConsumptionGuard gate carries on when the quota cannot be read (#531)', async () => {
  const guard = startConsumptionGuard({ driver: quotaDriver({ available: false, reason: 'fetch-failed' }), now: () => T0 })
  assert.ok(guard)
  await guard.poller.poll()
  assert.equal(guard.gate(), null)
  guard.stop()
})

test('startConsumptionGuard stop ends the polling (#531)', () => {
  const guard = startConsumptionGuard({ driver: quotaDriver(week(5)), now: () => T0 })
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
  const guard = startConsumptionGuard({ driver, now: () => T0 })
  // A run that pauses on the boundary should find out early, not one poll
  // interval in.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  guard?.stop()
})
