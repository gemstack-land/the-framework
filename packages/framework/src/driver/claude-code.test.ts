import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { existsSync, readFileSync } from 'node:fs'
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

test('StreamJsonParser pulls token + cost usage off the result line (#322)', () => {
  const p = new StreamJsonParser()
  p.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'done',
      session_id: 's',
      total_cost_usd: 0.1234,
      usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
    }),
  )
  assert.deepEqual(p.result(), {
    text: 'done',
    sessionId: 's',
    usage: { costUsd: 0.1234, inputTokens: 100, outputTokens: 40, cacheReadTokens: 900, cacheCreationTokens: 50 },
  })
})

test('StreamJsonParser leaves usage off when the result line reports none (#322)', () => {
  const p = new StreamJsonParser()
  p.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'done', session_id: 's' }))
  assert.deepEqual(p.result(), { text: 'done', sessionId: 's' })
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

test('runClaude rejects on a non-zero exit even when the agent streamed text', async () => {
  const events: DriverEvent[] = []
  const lines = [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'started building' }] } })]
  await assert.rejects(
    () =>
      runClaude({
        bin: 'claude',
        args: [],
        cwd: '/ws',
        env: {},
        prompt: 'x',
        spawn: fakeSpawn(lines, 1),
        emit: e => events.push(e),
        signals: [],
      }),
    /exited \(1\): started building/,
  )
  assert.equal(events.at(-1)!.type, 'error')
  assert.ok(!events.some(e => e.type === 'result'))
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

test('ClaudeCodeDriver omits --mcp-config when no mcpServers are configured', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const session = await new ClaudeCodeDriver({ spawn }).start({ cwd: '/ws' })
  await session.prompt('go')
  assert.ok(!captured.includes('--mcp-config'))
})

test('ClaudeCodeDriver writes an --mcp-config file for mcpServers and cleans it up on dispose', async () => {
  let captured: string[] = []
  const spawn: SpawnLike = (_cmd, args) => {
    captured = [...args]
    return fakeSpawn([JSON.stringify({ type: 'result', result: 'ok' })])(_cmd, args, { cwd: '/ws', env: {} })
  }
  const mcpServers = { 'chrome-devtools': { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] } }
  const session = await new ClaudeCodeDriver({ spawn, mcpServers }).start({ cwd: '/ws' })
  await session.prompt('go')
  const idx = captured.indexOf('--mcp-config')
  assert.ok(idx >= 0)
  const configPath = captured[idx + 1]!
  assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { mcpServers })
  // The path is stable across prompts in the same session (written once).
  const first = [...captured]
  await session.prompt('again')
  assert.equal(captured[captured.indexOf('--mcp-config') + 1], first[first.indexOf('--mcp-config') + 1])
  await session.dispose()
  assert.ok(!existsSync(configPath))
})

test('StreamJsonParser surfaces the rate-limit telemetry the agent emits per turn (#517)', () => {
  const p = new StreamJsonParser()
  // Real payload shape, captured from `claude -p --output-format stream-json`.
  const events = p.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1784079000,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        isUsingOverage: false,
      },
      session_id: 'sess-1',
    }),
  )
  assert.deepEqual(events, [
    // Seconds in, millis out.
    { type: 'rate-limit', limit: { status: 'allowed', window: 'five_hour', resetsAt: 1784079000_000 } },
  ])
  // Telemetry must not disturb the turn itself.
  assert.deepEqual(p.result(), { text: '', sessionId: 'sess-1' })
})

test('StreamJsonParser passes through rate-limit values it has never seen (#517)', () => {
  const p = new StreamJsonParser()
  // We have only ever observed status=allowed / window=five_hour. An unknown
  // value is the signal we are capturing for, so it must not be dropped.
  const events = p.push(
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', resetsAt: 1784079000, rateLimitType: 'seven_day_opus' },
    }),
  )
  assert.deepEqual(events, [
    { type: 'rate-limit', limit: { status: 'allowed_warning', window: 'seven_day_opus', resetsAt: 1784079000_000 } },
  ])
})

test('StreamJsonParser stays silent on a malformed rate_limit_event (#517)', () => {
  const p = new StreamJsonParser()
  // Reporting a bogus reset time is worse than reporting nothing.
  assert.deepEqual(p.push(JSON.stringify({ type: 'rate_limit_event' })), [])
  assert.deepEqual(p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: null })), [])
  assert.deepEqual(
    p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' } })),
    [],
  )
  assert.deepEqual(
    p.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', resetsAt: 'soon' } })),
    [],
  )
})
