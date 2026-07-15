import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'
import { CodexDriver, CodexJsonParser, parseCodexUsage } from './codex.js'
import type { SpawnLike, SpawnedProcess } from './claude-code.js'
import type { Driver, DriverEvent } from './types.js'

/** A real codex-cli 0.144.4 run, verbatim: "Create a file hello.txt containing exactly: hi". */
const REAL_RUN = [
  JSON.stringify({ type: 'thread.started', thread_id: '019f660b-bf69-7d62-a96c-34aad1f083db' }),
  JSON.stringify({ type: 'turn.started' }),
  JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll create `hello.txt`.' } }),
  JSON.stringify({ type: 'item.started', item: { id: 'item_1', type: 'file_change', status: 'in_progress' } }),
  JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'file_change', status: 'completed' } }),
  JSON.stringify({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Created hello.txt' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12210, cached_input_tokens: 9984, output_tokens: 5 } }),
]

test('CodexJsonParser takes the last message as the turn (#539)', () => {
  const p = new CodexJsonParser()
  for (const line of REAL_RUN) p.push(line)
  // Codex narrates as it goes; the last message is its answer, not the first.
  const turn = p.result()
  assert.equal(turn.text, 'Created hello.txt')
  assert.equal(turn.sessionId, '019f660b-bf69-7d62-a96c-34aad1f083db')
})

test('CodexJsonParser streams text and surfaces tool kinds only (#539)', () => {
  const p = new CodexJsonParser()
  const events = REAL_RUN.flatMap(line => p.push(line))
  assert.deepEqual(events, [
    { type: 'text', text: 'I’ll create `hello.txt`.' },
    { type: 'action', label: 'file_change' },
    { type: 'text', text: 'Created hello.txt' },
  ])
})

test('CodexJsonParser reports the tokens but never a price (#540)', () => {
  const p = new CodexJsonParser()
  for (const line of REAL_RUN) p.push(line)
  const usage = p.result().usage
  // The tokens are real and reported; `costUsd: 0` would read as free, so it is absent.
  assert.deepEqual(usage, {
    inputTokens: 2226, // 12210 total - 9984 cached
    outputTokens: 5,
    cacheReadTokens: 9984,
    cacheCreationTokens: 0,
  })
  assert.equal(usage?.costUsd, undefined)
  assert.equal('costUsd' in usage!, false)
})

test('parseCodexUsage splits the cached tokens out of the inclusive input total (#540)', () => {
  // Verbatim from codex-cli 0.144.4. `input_tokens` is the whole input, cached
  // included: repeating one prompt held it at 12218 while cached rose to 12032.
  const usage = parseCodexUsage({ input_tokens: 12218, cached_input_tokens: 12032, output_tokens: 6, reasoning_output_tokens: 0 })
  assert.deepEqual(usage, {
    inputTokens: 186,
    outputTokens: 6,
    cacheReadTokens: 12032,
    cacheCreationTokens: 0,
  })
})

test('parseCodexUsage does not double-count reasoning tokens (#540)', () => {
  // reasoning_output_tokens is a subset of output_tokens, as cached_input_tokens
  // is of input_tokens — adding it would inflate the count.
  const usage = parseCodexUsage({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 400 })
  assert.equal(usage?.outputTokens, 500)
})

test('parseCodexUsage survives a missing or malformed payload (#540)', () => {
  assert.equal(parseCodexUsage(undefined), undefined)
  assert.equal(parseCodexUsage('nonsense'), undefined)
  // Absent fields read as 0 rather than NaN, and a nonsense cache count can never
  // push the uncached input negative.
  assert.deepEqual(parseCodexUsage({}), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
  assert.deepEqual(parseCodexUsage({ input_tokens: 10, cached_input_tokens: 999 }), {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 10,
    cacheCreationTokens: 0,
  })
})

test('CodexJsonParser ignores noise that is not an event (#539)', () => {
  const p = new CodexJsonParser()
  assert.deepEqual(p.push('Reading additional input from stdin...'), [])
  assert.deepEqual(p.push(''), [])
  assert.deepEqual(p.push(JSON.stringify({ type: 'turn.started' })), [])
  assert.deepEqual(p.result(), { text: '' })
})

/** A fake process that emits the given lines then closes. */
function fakeSpawn(lines: string[], onSpawn?: (args: readonly string[], stdin: string) => void, code = 0): SpawnLike {
  return (_command, args) => {
    const stdout = Readable.from([lines.map(l => l + '\n').join('')])
    let written = ''
    const stdin = new Writable({
      write: (chunk, _e, cb) => {
        written += String(chunk)
        cb()
      },
    })
    const proc: SpawnedProcess = {
      stdout,
      stderr: Readable.from([]),
      stdin,
      on(event, listener) {
        if (event === 'close') stdout.on('end', () => (onSpawn?.(args, written), (listener as (c: number | null) => void)(code)))
        return proc
      },
      kill: () => undefined,
    }
    return proc
  }
}

test('CodexDriver runs a prompt through the CLI and returns the turn (#539)', async () => {
  const events: DriverEvent[] = []
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN) })
  const session = await driver.start({ cwd: '/ws', onEvent: e => events.push(e) })
  const turn = await session.prompt('build it')
  assert.equal(turn.text, 'Created hello.txt')
  assert.equal(turn.sessionId, '019f660b-bf69-7d62-a96c-34aad1f083db')
  assert.ok(events.some(e => e.type === 'action' && e.label === 'file_change'))
  assert.ok(events.some(e => e.type === 'result'))
})

test('CodexDriver runs sandboxed in the workspace, never with the bypass (#539)', async () => {
  let seen: readonly string[] = []
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN, args => (seen = args)) })
  const session = await driver.start({ cwd: '/ws' })
  await session.prompt('go')
  assert.deepEqual([...seen], ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', '/ws'])
  // The agent may edit its workspace and nothing else.
  assert.ok(!seen.includes('--dangerously-bypass-approvals-and-sandbox'))
  // Codex refuses to run outside a git repo, and a fresh workspace isn't one yet.
  assert.ok(seen.includes('--skip-git-repo-check'))
})

test('CodexDriver sends the prompt over stdin, not as an argument (#539)', async () => {
  let stdin = ''
  let seen: readonly string[] = []
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN, (args, written) => ((seen = args), (stdin = written))) })
  const session = await driver.start({ cwd: '/ws' })
  await session.prompt('a very long prompt')
  // Over stdin so a long prompt never hits the arg-length limit.
  assert.equal(stdin, 'a very long prompt')
  assert.ok(!seen.includes('a very long prompt'))
})

test('CodexDriver prepends the framing, since Codex has no system-prompt flag (#539)', async () => {
  let stdin = ''
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN, (_a, written) => (stdin = written)) })
  const session = await driver.start({ cwd: '/ws', system: 'You are careful.' })
  await session.prompt('do the thing', { system: 'Also: be brief.' })
  assert.equal(stdin, 'You are careful.\n\nAlso: be brief.\n\ndo the thing')
})

test('CodexDriver passes the model through (#539)', async () => {
  let seen: readonly string[] = []
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN, args => (seen = args)) })
  const session = await driver.start({ cwd: '/ws', model: 'gpt-5-codex' })
  await session.prompt('go')
  assert.ok(seen.includes('-m') && seen.includes('gpt-5-codex'))
})

test('CodexDriver cannot report a quota, so it says so by omission (#539)', () => {
  // The seam is optional precisely for this: no readQuota means no consumption
  // limits for Codex, rather than a made-up number.
  const driver: Driver = new CodexDriver()
  assert.equal(driver.readQuota, undefined)
})

test('CodexDriver fails the turn on a non-zero exit (#539)', async () => {
  const driver = new CodexDriver({ spawn: fakeSpawn(REAL_RUN, undefined, 1) })
  const session = await driver.start({ cwd: '/ws' })
  // A crash mid-build must not pass as a result, even though text streamed first.
  await assert.rejects(() => session.prompt('go'), /codex exited \(1\)/)
})
