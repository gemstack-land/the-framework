import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { QueuedPromptBuilder, _setQueueJobLoadersForTests } from './queue-job.js'
import type { AgentResponse, AgentStreamResponse, StreamChunk } from './types.js'

// ─── Test seam wiring ─────────────────────────────────────

interface DispatchedJob {
  fn:    () => void | Promise<void>
  queue: string | undefined
  delay: number | undefined
}

interface BroadcastCall {
  channel: string
  event:   string
  data:    unknown
}

let dispatched:    DispatchedJob[] = []
let broadcasts:    BroadcastCall[] = []
let restoreLoaders: () => void = () => {}

beforeEach(() => {
  dispatched = []
  broadcasts = []
  restoreLoaders = _setQueueJobLoadersForTests({
    dispatch: async () => async (fn, options) => {
      dispatched.push({ fn, queue: options?.queue, delay: options?.delay })
      // Run immediately (in-memory adapter style) so the test observes side effects synchronously.
      await fn()
    },
    broadcast: async () => (channel, event, data) => {
      broadcasts.push({ channel, event, data })
    },
  })
})

afterEach(() => {
  restoreLoaders()
})

// ─── Fixture agents ───────────────────────────────────────

const fakeResponse: AgentResponse = {
  text: 'final answer', steps: [],
  usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
  finishReason: 'stop',
} as unknown as AgentResponse

function makePromptOnlyAgent() {
  const calls: { input: string }[] = []
  const agent = {
    async prompt(input: string) {
      calls.push({ input })
      return fakeResponse
    },
  }
  return { agent, calls }
}

function makeStreamingAgent(chunks: StreamChunk[]) {
  const calls: { input: string }[] = []
  const agent = {
    async prompt(input: string) {
      calls.push({ input })
      return fakeResponse
    },
    stream(input: string): AgentStreamResponse {
      calls.push({ input })
      const stream: AsyncIterable<StreamChunk> = {
        async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
      }
      return { stream, response: Promise.resolve(fakeResponse) }
    },
  }
  return { agent, calls }
}

// ─── Builder mechanics ────────────────────────────────────

describe('QueuedPromptBuilder — builder mechanics', () => {
  it('chains onQueue() / delay() / then() / catch() and returns this', () => {
    const { agent } = makePromptOnlyAgent()
    const b = new QueuedPromptBuilder(agent, 'hi')
    const ret = b.onQueue('ai').delay(100).then(() => {}).catch(() => {})
    assert.strictEqual(ret, b)
  })

  it('broadcast() returns this and stores channel + default empty prefix', async () => {
    const { agent } = makePromptOnlyAgent()
    const b = new QueuedPromptBuilder(agent, 'hi')
    assert.strictEqual(b.broadcast('chan'), b)
  })
})

// ─── Default (non-broadcast) path ─────────────────────────

describe('QueuedPromptBuilder — default prompt() path', () => {
  it('dispatches a job that calls agent.prompt() with the input', async () => {
    const { agent, calls } = makePromptOnlyAgent()
    await new QueuedPromptBuilder(agent, 'hello').send()
    assert.strictEqual(dispatched.length, 1)
    assert.deepStrictEqual(calls, [{ input: 'hello' }])
    assert.strictEqual(broadcasts.length, 0, 'no broadcasts when .broadcast() not called')
  })

  it('passes onQueue + delay through to the dispatcher', async () => {
    const { agent } = makePromptOnlyAgent()
    await new QueuedPromptBuilder(agent, 'hi').onQueue('ai').delay(500).send()
    assert.strictEqual(dispatched[0]?.queue, 'ai')
    assert.strictEqual(dispatched[0]?.delay, 500)
  })

  it('invokes then() with the response on success', async () => {
    const { agent } = makePromptOnlyAgent()
    let received: AgentResponse | undefined
    await new QueuedPromptBuilder(agent, 'hi').then(r => { received = r }).send()
    assert.strictEqual(received, fakeResponse)
  })

  it('invokes catch() when prompt() throws', async () => {
    const errAgent = { async prompt() { throw new Error('boom') } }
    let caught: unknown
    await new QueuedPromptBuilder(errAgent, 'x').catch(e => { caught = e }).send()
    assert.ok(caught instanceof Error)
    assert.strictEqual((caught as Error).message, 'boom')
  })

  it('rethrows when no catch() handler is set', async () => {
    const errAgent = { async prompt() { throw new Error('boom') } }
    await assert.rejects(
      () => new QueuedPromptBuilder(errAgent, 'x').send(),
      /boom/,
    )
  })
})

// ─── Broadcast path ───────────────────────────────────────

describe('QueuedPromptBuilder — broadcast() path', () => {
  it('streams chunks to the channel and emits done on completion', async () => {
    const chunks: StreamChunk[] = [
      { type: 'text-delta', text: 'hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'finish', finishReason: 'stop' },
    ]
    const { agent } = makeStreamingAgent(chunks)
    await new QueuedPromptBuilder(agent, 'hi').broadcast('user.42').send()

    assert.strictEqual(broadcasts.length, 4, '3 chunks + 1 done')
    assert.strictEqual(broadcasts[0]?.channel, 'user.42')
    assert.strictEqual(broadcasts[0]?.event,   'chunk')
    assert.strictEqual(broadcasts[3]?.event,   'done')
    assert.strictEqual(broadcasts[3]?.data,    fakeResponse)
  })

  it('honors eventPrefix on every event', async () => {
    const chunks: StreamChunk[] = [{ type: 'text-delta', text: 'x' }, { type: 'finish', finishReason: 'stop' }]
    const { agent } = makeStreamingAgent(chunks)
    await new QueuedPromptBuilder(agent, 'hi').broadcast('chan', { eventPrefix: 'agent.' }).send()
    assert.deepStrictEqual(broadcasts.map(b => b.event), ['agent.chunk', 'agent.chunk', 'agent.done'])
  })

  it('emits an error event and rethrows when stream throws', async () => {
    const errStreamAgent = {
      async prompt() { return fakeResponse },
      stream() {
        const stream: AsyncIterable<StreamChunk> = {
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() { throw new Error('stream-fail') },
        }
        // Pending response (never settles) — production stream() resolves
        // response after the stream completes, but we throw mid-stream so
        // this branch never gets awaited. A pending Promise is fine; a
        // rejected one would trip unhandled-rejection on the test runner.
        return { stream, response: new Promise<AgentResponse>(() => {}) }
      },
    }
    await assert.rejects(
      () => new QueuedPromptBuilder(errStreamAgent, 'x').broadcast('chan').send(),
      /stream-fail/,
    )
    assert.ok(broadcasts.some(b => b.event === 'error'), 'expected an error event on the channel')
    const errEvent = broadcasts.find(b => b.event === 'error')
    assert.match((errEvent?.data as { message: string }).message, /stream-fail/)
  })

  it('throws a clear error when broadcast peer is missing', async () => {
    restoreLoaders()  // Drop the per-test fakes
    restoreLoaders = _setQueueJobLoadersForTests({
      dispatch:  async () => async (fn) => { await fn() },
      broadcast: async () => null,
    })
    const { agent } = makeStreamingAgent([{ type: 'finish', finishReason: 'stop' }])
    await assert.rejects(
      () => new QueuedPromptBuilder(agent, 'x').broadcast('chan').send(),
      /@rudderjs\/broadcast/,
    )
  })

  it('throws when the agent has no stream() method but .broadcast() was set', async () => {
    const { agent } = makePromptOnlyAgent()
    await assert.rejects(
      () => new QueuedPromptBuilder(agent, 'x').broadcast('chan').send(),
      /requires an agent with \.stream/,
    )
  })

  it('still calls then() with the final response after broadcast completes', async () => {
    const chunks: StreamChunk[] = [{ type: 'finish', finishReason: 'stop' }]
    const { agent } = makeStreamingAgent(chunks)
    let received: AgentResponse | undefined
    await new QueuedPromptBuilder(agent, 'hi')
      .broadcast('chan')
      .then(r => { received = r })
      .send()
    assert.strictEqual(received, fakeResponse)
  })
})
