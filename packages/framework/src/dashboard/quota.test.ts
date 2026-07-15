import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { pollerQuotaSource } from './quota.js'
import { QuotaPoller } from '../quota-poller.js'
import { DEFAULT_CONSUMPTION_LIMITS, type ConsumptionLimits } from '../consumption.js'
import type { DriverQuota } from '../driver/index.js'

const T0 = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function week(percentUsed: number): DriverQuota {
  return {
    available: true,
    windows: [
      { label: 'Current session', kind: 'session', percentUsed: 2, resetsAtText: 'in 2h 53m' },
      { label: 'Current week (all models)', kind: 'week', percentUsed },
    ],
  }
}

function sourceOf(script: DriverQuota[], limits: ConsumptionLimits = DEFAULT_CONSUMPTION_LIMITS) {
  let at = T0
  let i = 0
  const poller = new QuotaPoller({ read: () => Promise.resolve(script[Math.min(i++, script.length - 1)] as DriverQuota), now: () => at })
  return { source: pollerQuotaSource(poller, () => Promise.resolve(limits)), poller, advance: (ms: number) => (at += ms) }
}

test('the usage panel gets the account windows and where the limits stand (#533)', async () => {
  const { source, poller, advance } = sourceOf([week(10), week(16)])
  await poller.poll()
  advance(HOUR)
  await poller.poll()
  const view = await source.read()
  // The account's own bars, as Traycer shows them.
  assert.equal(view.windows.length, 2)
  assert.equal(view.windows.find(w => w.kind === 'week')?.percentUsed, 16)
  assert.equal(view.readAt, T0 + HOUR)
  assert.equal(view.unavailable, undefined)
  // And the limits: 6 points of the day's 20.
  assert.equal(view.limits.daily.consumed, 6)
  assert.equal(view.limits.daily.usedPercent, 30)
  assert.equal(view.limits.reached, null)
})

test('the usage panel keeps the last reading and marks it stale on a blip (#533)', async () => {
  const { source, poller, advance } = sourceOf([week(10), { available: false, reason: 'fetch-failed' }])
  await poller.poll()
  advance(1000)
  await poller.poll()
  const view = await source.read()
  // The number is a second old; blanking it would read as "nothing used".
  assert.equal(view.windows.find(w => w.kind === 'week')?.percentUsed, 10)
  assert.equal(view.readAt, T0)
  assert.equal(view.unavailable, 'fetch-failed')
})

test('the usage panel reports no reading rather than an empty one (#533)', async () => {
  const { source } = sourceOf([{ available: false, reason: 'no-subscription' }])
  const view = await source.read()
  assert.deepEqual(view.windows, [])
  // Undefined, not 0: an empty bar would say "nothing used" on an account we
  // cannot read at all.
  assert.equal(view.limits.daily.consumed, undefined)
  assert.equal(view.limits.daily.usedPercent, undefined)
  assert.equal(view.limits.reached, null)
})

test('the usage panel leaves the session bar unmeasured when nothing is running (#533)', async () => {
  const { source, poller } = sourceOf([week(10)])
  await poller.poll()
  const view = await source.read()
  // The panel is account-wide; a session bar belongs to a run's own guard.
  assert.equal(view.limits.session.consumed, undefined)
})

test('the usage panel re-reads the limits, so a settings change re-scales the bars (#533)', async () => {
  let limits: ConsumptionLimits = DEFAULT_CONSUMPTION_LIMITS
  let at = T0
  let i = 0
  const script = [week(10), week(15)]
  const poller = new QuotaPoller({ read: () => Promise.resolve(script[Math.min(i++, 1)] as DriverQuota), now: () => at })
  const source = pollerQuotaSource(poller, () => Promise.resolve(limits))
  await poller.poll()
  at += HOUR
  await poller.poll()
  assert.equal((await source.read()).limits.daily.usedPercent, 25) // 5 of 20

  limits = { ...DEFAULT_CONSUMPTION_LIMITS, daily: { enabled: true, percent: 10 } }
  // No restart: the same 5 points are now half the day's budget.
  assert.equal((await source.read()).limits.daily.usedPercent, 50)
})

test('the usage panel falls back to the defaults when the limits cannot be read (#533)', async () => {
  const { poller } = sourceOf([week(10)])
  // An unreadable preferences file must not take the guard rails off.
  const source = pollerQuotaSource(poller, () => Promise.reject(new Error('registry unreadable')))
  await poller.poll()
  assert.equal((await source.read()).limits.daily.budget, 20)
})

test('stopping the source ends the polling (#533)', () => {
  const { source, poller } = sourceOf([week(10)])
  source.stop()
  assert.equal(poller.isStopped, true)
})
