import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunMessageQueue } from './run-messages.js'

test('RunMessageQueue drains already-queued messages in order (between turns)', async () => {
  const q = new RunMessageQueue()
  q.push('one')
  q.push('two')
  assert.equal(await q.next(), 'one')
  assert.equal(await q.next(), 'two')
})

test('RunMessageQueue hands a message to a parked waiter (stay-open)', async () => {
  const q = new RunMessageQueue()
  const pending = q.next() // parks: nothing queued yet
  q.push('later')
  assert.equal(await pending, 'later')
})

test('RunMessageQueue close() wakes a parked waiter with undefined', async () => {
  const q = new RunMessageQueue()
  const pending = q.next()
  q.close()
  assert.equal(await pending, undefined)
})

test('RunMessageQueue next() resolves undefined once closed', async () => {
  const q = new RunMessageQueue()
  q.close()
  assert.equal(await q.next(), undefined)
})

test('RunMessageQueue push() is a no-op after close()', async () => {
  const q = new RunMessageQueue()
  q.close()
  q.push('ignored')
  assert.equal(await q.next(), undefined)
})

test('RunMessageQueue next() unblocks on abort (Stop / budget cap)', async () => {
  const q = new RunMessageQueue()
  const ac = new AbortController()
  const pending = q.next(ac.signal)
  ac.abort()
  assert.equal(await pending, undefined)
})

test('RunMessageQueue next() returns a queued message even if the signal is aborted', async () => {
  const q = new RunMessageQueue()
  const ac = new AbortController()
  ac.abort()
  q.push('queued')
  // A message already in hand wins over the aborted signal: it is not lost.
  assert.equal(await q.next(ac.signal), 'queued')
})
