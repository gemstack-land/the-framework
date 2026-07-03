import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { ClaudeCodeDriver, StreamJsonParser, runClaude, type SpawnLike, type SpawnedProcess } from './claude-code.js'
import type { DriverEvent } from './types.js'

test('StreamJsonParser surfaces assistant text + tool names, keeps the result', () => {
  const p = new StreamJsonParser()
  assert.deepEqual(p.push(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' })), [])
  const assistant = p.push(
    JSON.stringify({
      type: 'assistant',
      session_id: 'sess-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Working' }, { type: 'tool_use', name: 'Write' }] },
    }),
  )
  assert.deepEqual(assistant, [
    { type: 'text', text: 'Working' },
    { type: 'action', label: 'Write' },
  ])
  assert.deepEqual(p.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'All done', session_id: 'sess-1' })), [])
  assert.deepEqual(p.result(), { text: 'All done', sessionId: 'sess-1' })
})

test('StreamJsonParser ignores non-JSON noise and falls back to assistant text', () => {
  const p = new StreamJsonParser()
  assert.deepEqual(p.push('some banner line'), [])
  p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }))
  assert.deepEqual(p.result(), { text: 'partial' })
})

// A fake process that streams the given stream-json lines then closes.
function fakeSpawn(lines: string[], code = 0, stderr = ''): SpawnLike {
  return () => {
    const stdout = Readable.from([lines.map(l => l + '\n').join('')])
    const stderrStream = Readable.from(stderr ? [stderr] : [])
    const stdin = new Writable({ write: (_c, _e, cb) => cb() })
    const proc: SpawnedProcess = {
      stdout,
      stderr: stderrStream,
      stdin,
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (listener as (c: number | null) => void)(code))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('runClaude drives a fake process and returns the final turn', async () => {
  const events: DriverEvent[] = []
  const lines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
    JSON.stringify({ type: 'result', subtype: 'success', result: 'built it', session_id: 's9' }),
  ]
  const turn = await runClaude({
    bin: 'claude',
    args: ['-p'],
    cwd: '/ws',
    env: {},
    prompt: 'build',
    spawn: fakeSpawn(lines),
    emit: e => events.push(e),
    signals: [],
  })
  assert.deepEqual(turn, { text: 'built it', sessionId: 's9' })
  assert.equal(events[0]!.type, 'start')
  assert.ok(events.some(e => e.type === 'action' && e.label === 'Bash'))
  assert.equal(events.at(-1)!.type, 'result')
})

test('runClaude rejects on a non-zero exit with no result text', async () => {
  await assert.rejects(
    () =>
      runClaude({
        bin: 'claude',
        args: [],
        cwd: '/ws',
        env: {},
        prompt: 'x',
        spawn: fakeSpawn([], 1, 'boom'),
        emit: () => {},
        signals: [],
      }),
    /boom/,
  )
})

test('ClaudeCodeDriver builds correct CLI args (permission mode, system, model)', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const driver = new ClaudeCodeDriver({ spawn })
  const session = await driver.start({ cwd: '/ws', system: 'You are a Vike expert', model: 'claude-haiku-4-5-20251001' })
  await session.prompt('go')
  assert.deepEqual(captured.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose'])
  assert.ok(captured.includes('--permission-mode'))
  assert.ok(captured.includes('acceptEdits'))
  assert.ok(captured.includes('--append-system-prompt'))
  assert.ok(captured.includes('You are a Vike expert'))
  assert.ok(captured.includes('--model'))
  assert.ok(captured.includes('claude-haiku-4-5-20251001'))
})
