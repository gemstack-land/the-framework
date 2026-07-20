import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { startDiscordBot, type DiscordBotOptions } from './bot.js'
import type { DiscordMessage, GatewaySocket } from './gateway.js'
import type { RunSnapshot } from './routing.js'

/** A socket that does nothing: these tests drive `handleMessage` directly. */
const deadSocket: GatewaySocket = {
  send: () => {},
  close: () => {},
  onMessage: () => {},
  onClose: () => {},
  onError: () => {},
}

interface Calls {
  messages: { projectId: string; text: string; runId: string }[]
  choices: { projectId: string; gateId: string; pick: string | string[]; runId: string }[]
  stops: { projectId: string; runId: string }[]
  starts: { projectId: string; text: string }[]
  posted: string[]
}

function bot(over: Partial<DiscordBotOptions> = {}) {
  const calls: Calls = { messages: [], choices: [], stops: [], starts: [], posted: [] }
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls.posted.push(String(JSON.parse(String(init?.body))['content']))
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch

  const handle = startDiscordBot({
    token: 'tok',
    target: async () => ({ id: 'p1', name: 'gemstack' }),
    liveRun: async () => undefined,
    start: async (projectId, text) => {
      calls.starts.push({ projectId, text })
      return 'r-new'
    },
    sendMessage: async (projectId, text, runId) => {
      calls.messages.push({ projectId, text, runId })
    },
    sendChoice: async (projectId, gateId, pick, runId) => {
      calls.choices.push({ projectId, gateId, pick, runId })
    },
    sendStop: async (projectId, runId) => {
      calls.stops.push({ projectId, runId })
    },
    fetchImpl,
    gateway: { socket: () => deadSocket, interval: () => ({ stop: () => {} }), url: 'wss://test' },
    ...over,
  })
  return { handle, calls }
}

function message(over: Partial<DiscordMessage> = {}): DiscordMessage {
  return { id: 'm1', channelId: 'c1', content: 'hello', authorId: 'u1', authorName: 'sul', fromBot: false, ...over }
}

const liveRun = (gate?: RunSnapshot['gate']): DiscordBotOptions['liveRun'] =>
  async () => ({ projectId: 'p1', runId: 'r1', ...(gate ? { gate } : {}) })

test('a message with no run live starts one and says so', async () => {
  const { handle, calls } = bot()
  await handle.handleMessage(message({ content: 'add a hello function' }))

  assert.deepEqual(calls.starts, [{ projectId: 'p1', text: 'add a hello function' }])
  assert.equal(calls.messages.length, 0)
  assert.match(calls.posted[0] ?? '', /Starting a session/)
})

test('a message with a run live reaches the run through the control channel', async () => {
  const { handle, calls } = bot({ liveRun: liveRun() })
  await handle.handleMessage(message({ content: 'also add tests' }))

  assert.deepEqual(calls.messages, [{ projectId: 'p1', text: 'also add tests', runId: 'r1' }])
  assert.equal(calls.starts.length, 0)
})

test('a numbered reply answers the parked gate', async () => {
  const gate = { id: 'g1', title: 'Proceed?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }
  const { handle, calls } = bot({ liveRun: liveRun(gate) })
  await handle.handleMessage(message({ content: '2' }))

  assert.deepEqual(calls.choices, [{ projectId: 'p1', gateId: 'g1', pick: 'no', runId: 'r1' }])
})

test('the bot does nothing while the preference is off', async () => {
  const { handle, calls } = bot({ enabled: async () => false })
  await handle.handleMessage(message({ content: 'do a thing' }))

  assert.equal(calls.starts.length, 0)
  assert.equal(calls.posted.length, 0, 'not even a reply: an off bot is silent')
})

test('the preference is read per message, so a toggle needs no restart', async () => {
  let on = false
  const { handle, calls } = bot({ enabled: async () => on })
  await handle.handleMessage(message({ content: 'first' }))
  on = true
  await handle.handleMessage(message({ content: 'second' }))

  assert.deepEqual(calls.starts, [{ projectId: 'p1', text: 'second' }])
})

test('a channel filter ignores everything else', async () => {
  const { handle, calls } = bot({ channelId: 'only-here' })
  await handle.handleMessage(message({ channelId: 'elsewhere' }))
  assert.equal(calls.starts.length, 0)

  await handle.handleMessage(message({ channelId: 'only-here', content: 'go' }))
  assert.deepEqual(calls.starts, [{ projectId: 'p1', text: 'go' }])
})

test('a run that will not start is reported, not silently dropped', async () => {
  const { handle, calls } = bot({ start: async () => undefined })
  await handle.handleMessage(message({ content: 'go' }))
  assert.match(calls.posted[0] ?? '', /Could not start/)
})

test('no registered project is reported rather than throwing', async () => {
  const { handle, calls } = bot({ target: async () => undefined })
  await handle.handleMessage(message())
  assert.match(calls.posted[0] ?? '', /No project is registered/)
})

test('a failing effect is logged, never thrown at the gateway', async () => {
  const logs: string[] = []
  const { handle } = bot({
    start: async () => {
      throw new Error('boom')
    },
    onLog: m => logs.push(m),
  })
  await assert.doesNotReject(handle.handleMessage(message({ content: 'go' })))
  assert.ok(logs.some(l => /boom/.test(l)), `expected the failure logged, got ${JSON.stringify(logs)}`)
})

test('!stop stops the live run', async () => {
  const { handle, calls } = bot({ liveRun: liveRun() })
  await handle.handleMessage(message({ content: '!stop' }))
  assert.deepEqual(calls.stops, [{ projectId: 'p1', runId: 'r1' }])
})

test('stop() is safe to call and takes the bot offline', () => {
  const { handle } = bot()
  assert.doesNotThrow(() => handle.stop())
  assert.doesNotThrow(() => handle.stop(), 'idempotent')
})
