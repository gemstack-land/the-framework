import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { RunMessageQueue } from './run-messages.js'

test('RunMessageQueue drains already-queued messages in order (between turns)', async () => {
  const q = new RunMessageQueue()
  q.push('one')
  q.push('two')
  assert.deepEqual(await q.next(), { text: 'one' })
  assert.deepEqual(await q.next(), { text: 'two' })
})

test('RunMessageQueue hands a message to a parked waiter (stay-open)', async () => {
  const q = new RunMessageQueue()
  const pending = q.next() // parks: nothing queued yet
  q.push('later')
  assert.deepEqual(await pending, { text: 'later' })
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
  assert.deepEqual(await q.next(ac.signal), { text: 'queued' })
})

test('RunMessageQueue carries the originating surface with the message (#917)', async () => {
  const q = new RunMessageQueue()
  q.push('from discord', 'discord')
  q.push('from here')
  assert.deepEqual(await q.next(), { text: 'from discord', via: 'discord' })
  assert.deepEqual(await q.next(), { text: 'from here' }, 'no via means the run attributes it locally')
})

test('RunMessageQueue hands the surface to a parked waiter too (#917)', async () => {
  const q = new RunMessageQueue()
  const pending = q.next()
  q.push('later', 'discord')
  assert.deepEqual(await pending, { text: 'later', via: 'discord' })
})
