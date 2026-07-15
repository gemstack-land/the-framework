import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_POLL_MS, MAX_POLL_MS, QuotaPoller } from './quota-poller.js'
import { ONE_DAY_MS } from './consumption.js'
import type { DriverQuota } from './driver/index.js'

const T0 = 1_800_000_000_000

function goodAt(weeklyPercent: number, sessionPercent = 1): DriverQuota {
  return {
    available: true,
    windows: [
      { label: 'Current session', kind: 'session', percentUsed: sessionPercent },
      { label: 'Current week (all models)', kind: 'week', percentUsed: weeklyPercent },
      { label: 'Current week (Fable)', kind: 'week-model', percentUsed: 3 },
    ],
  }
}

/** A poller reading a scripted sequence, one entry per poll, on a fake clock. */
function pollerOf(script: DriverQuota[], startAt = T0) {
  let at = startAt
  let i = 0
  const poller = new QuotaPoller({
    read: () => Promise.resolve(script[Math.min(i++, script.length - 1)] as DriverQuota),
    now: () => at,
  })
  return { poller, advance: (ms: number) => (at += ms) }
}

test('QuotaPoller feeds the meter from the weekly window (#525)', async () => {
  const { poller, advance } = pollerOf([goodAt(10), goodAt(14)])
  await poller.poll()
  advance(60_000)
  await poller.poll()
  // The session and per-model windows must not be mistaken for the weekly meter.
  assert.equal(poller.meter.size, 2)
  assert.equal(poller.meter.rolling(ONE_DAY_MS, T0 + 60_000)?.points, 4)
})

test('QuotaPoller keeps the last good reading through a transient failure (#525)', async () => {
  const { poller, advance } = pollerOf([goodAt(10), { available: false, reason: 'fetch-failed' }])
  await poller.poll()
  advance(1000)
  await poller.poll()
  const env = poller.current()
  // The blip is the latest attempt, but a minute-old real number still stands:
  // blanking the bar would read as "nothing used".
  assert.deepEqual(env.latest, { available: false, reason: 'fetch-failed' })
  assert.ok(env.lastGood?.available)
  assert.equal(env.lastGoodAt, T0)
  assert.equal(env.lastFailureAt, T0 + 1000)
  assert.equal(poller.isStopped, false)
})

test('QuotaPoller backs off when the fetch keeps being refused (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'fetch-failed' }])
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
  await poller.poll()
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS * 2)
  await poller.poll()
  // Retrying harder would sit inside the upstream penalty window and keep the
  // number permanently unavailable.
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS * 4)
})

test('QuotaPoller stops stretching the gap at the ceiling (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'timeout' }])
  for (let i = 0; i < 20; i++) await poller.poll()
  assert.equal(poller.intervalMs, MAX_POLL_MS)
})

test('QuotaPoller returns to the normal gap once the fetch works again (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'fetch-failed' }, { available: false, reason: 'fetch-failed' }, goodAt(9)])
  await poller.poll()
  await poller.poll()
  assert.ok(poller.intervalMs > DEFAULT_POLL_MS)
  await poller.poll()
  assert.equal(poller.intervalMs, DEFAULT_POLL_MS)
})

test('QuotaPoller gives up on an authoritative failure (#525)', async () => {
  const { poller } = pollerOf([goodAt(10), { available: false, reason: 'no-subscription' }])
  await poller.poll()
  await poller.poll()
  // Nothing changes by asking an API-key account again, and the retained
  // reading would misrepresent it.
  assert.equal(poller.isStopped, true)
  assert.equal(poller.current().lastGood, undefined)
  assert.equal(poller.current().lastGoodAt, undefined)
})

test('QuotaPoller gives up when the agent is missing (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'agent-not-found' }])
  await poller.poll()
  assert.equal(poller.isStopped, true)
})

test('QuotaPoller treats a reworded readout as authoritative and stops (#525)', async () => {
  const { poller } = pollerOf([{ available: false, reason: 'unrecognized' }])
  await poller.poll()
  // Polling on wouldn't reword it back; this needs a code change, not a retry.
  assert.equal(poller.isStopped, true)
})

test('QuotaPoller survives a driver that throws (#525)', async () => {
  const poller = new QuotaPoller({ read: () => Promise.reject(new Error('spawn exploded')), now: () => T0 })
  const quota = await poller.poll()
  // A throw is the same story as a failed fetch: this attempt told us nothing.
  assert.deepEqual(quota, { available: false, reason: 'fetch-failed' })
  assert.equal(poller.isStopped, false)
})

test('QuotaPoller ignores a reading with no weekly window (#525)', async () => {
  const { poller } = pollerOf([{ available: true, windows: [{ label: 'Current session', kind: 'session', percentUsed: 5 }] }])
  await poller.poll()
  // Nothing to anchor the limits to, but it's still a successful read.
  assert.equal(poller.meter.size, 0)
  assert.ok(poller.current().lastGood?.available)
})

test('QuotaPoller prunes samples it no longer needs (#525)', async () => {
  let at = T0
  let weekly = 1
  const poller = new QuotaPoller({ read: () => Promise.resolve(goodAt(weekly)), now: () => at })
  for (let i = 0; i < 5; i++) {
    await poller.poll()
    at += 12 * 60 * 60 * 1000
    weekly += 1
  }
  // Five readings 12h apart, but only a day's worth is ever needed.
  assert.ok(poller.meter.size <= 3, `kept ${poller.meter.size} samples`)
})

test('QuotaPoller.stop is idempotent and start does not revive it (#525)', () => {
  const { poller } = pollerOf([goodAt(1)])
  poller.stop()
  poller.stop()
  poller.start()
  assert.equal(poller.isStopped, true)
})
