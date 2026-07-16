import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { runAgentCli, type AgentCliParser, type SpawnLike, type SpawnedProcess } from './agent-cli.js'
import type { DriverEvent } from './types.js'

test('runAgentCli streams the parser events and resolves the final turn', async () => {
  const events: DriverEvent[] = []
  const parser: AgentCliParser = {
    push: line => (line === 'hi' ? [{ type: 'text', text: 'hi' }] : []),
    result: () => ({ text: 'done', sessionId: 's1' }),
  }
  const stdout = Readable.from(['hi\n'])
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(0))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const turn = await runAgentCli({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn,
    emit: e => events.push(e),
    signals: [],
    parser,
  })
  assert.deepEqual(turn, { text: 'done', sessionId: 's1' })
  assert.equal(events[0]!.type, 'start')
  assert.ok(events.some(e => e.type === 'text'))
  assert.equal(events.at(-1)!.type, 'result')
})

test('runAgentCli emits no telemetry when the process closes after an abort', async () => {
  const events: DriverEvent[] = []
  const controller = new AbortController()
  // A process whose `close` fires only when the test triggers it, so we can order
  // the abort strictly before the (killed) process's late exit.
  let fireClose: (code: number | null) => void = () => {}
  const spawn: SpawnLike = () => {
    const proc: SpawnedProcess = {
      stdout: Readable.from([]),
      stderr: Readable.from([]),
      stdin: new Writable({ write: (_c, _e, cb) => cb() }),
      on(event, listener) {
        if (event === 'close') fireClose = listener as (c: number | null) => void
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
  const promise = runAgentCli({
    bin: 'agent',
    args: [],
    cwd: '/ws',
    env: {},
    prompt: 'go',
    spawn,
    emit: e => events.push(e),
    signals: [controller.signal],
    parser: { push: () => [], result: () => ({ text: '' }) },
  })
  controller.abort()
  fireClose(null) // the killed process reports its exit after the abort already rejected
  await assert.rejects(promise, /aborted/)
  assert.ok(!events.some(e => e.type === 'error'), 'no error event after abort')
  assert.ok(!events.some(e => e.type === 'result'), 'no result event after abort')
})
