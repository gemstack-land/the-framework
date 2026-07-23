import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver } from './fake.js'
import type { DriverEvent } from './types.js'

test('FakeDriver replays scripted turns in order and repeats the last', async () => {
  const driver = new FakeDriver({ turns: [{ text: 'one' }, { text: 'two' }] })
  const session = await driver.start({ cwd: '/ws' })
  assert.equal((await session.prompt('a')).text, 'one')
  assert.equal((await session.prompt('b')).text, 'two')
  assert.equal((await session.prompt('c')).text, 'two') // last repeats
  assert.deepEqual(session.prompts, ['a', 'b', 'c'])
})

test('FakeDriver answers dynamically when respond is given', async () => {
  const driver = new FakeDriver({ respond: (prompt, i) => `${i}:${prompt.toUpperCase()}` })
  const session = await driver.start({ cwd: '/ws' })
  assert.equal((await session.prompt('hi')).text, '0:HI')
  assert.equal((await session.prompt('yo')).text, '1:YO')
})

test('FakeDriver emits start, actions, text, result events', async () => {
  const events: DriverEvent[] = []
  const driver = new FakeDriver({ turns: [{ text: 'done', actions: ['Write', 'Bash'] }] })
  const session = await driver.start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('go')
  assert.equal(turn.sessionId, 'fake-session')
  assert.deepEqual(
    events.map(e => e.type),
    ['start', 'action', 'action', 'text', 'result'],
  )
})

test('FakeDriver readCode returns seeded files and rejects unknown ones', async () => {
  const driver = new FakeDriver({ files: { 'a.txt': 'hello' } })
  const session = await driver.start({ cwd: '/ws' })
  assert.equal(await session.readCode!('a.txt'), 'hello')
  await assert.rejects(() => session.readCode!('missing.txt'))
})

test('FakeDriver rejects when the session signal is aborted', async () => {
  const driver = new FakeDriver({ turns: [{ text: 'x' }] })
  const session = await driver.start({ cwd: '/ws', signal: AbortSignal.abort() })
  await assert.rejects(() => session.prompt('go'))
})
