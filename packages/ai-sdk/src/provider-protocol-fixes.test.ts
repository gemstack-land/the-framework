import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleAdapter } from './providers/google.js'
import { GoogleCacheRegistry } from './providers/google-cache-registry.js'
import { splitSystemMessages } from './providers/anthropic.js'
import { OpenAIProvider } from './providers/openai.js'
import type { AiMessage, StreamChunk } from './types.js'

async function collect(it: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const c of it) out.push(c)
  return out
}

/** A Gemini client double that records request payloads and replays a scripted stream. */
function fakeGoogleClient(streamChunks: unknown[] = []) {
  const payloads: Record<string, unknown>[] = []
  const client = {
    caches: {
      async create() { return { name: 'cachedContents/auto-1' } },
      async delete() { /* no-op */ },
    },
    models: {
      async generateContent(payload: Record<string, unknown>) {
        payloads.push(payload)
        return { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }
      },
      async generateContentStream(payload: Record<string, unknown>) {
        payloads.push(payload)
        return (async function* () { for (const c of streamChunks) yield c })()
      },
    },
  }
  return { client, payloads }
}

describe('google prompt cache — only the regions actually cached are dropped', () => {
  it('still sends the system instruction when the markers did not cache it', async () => {
    const { client, payloads } = fakeGoogleClient()
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash', new GoogleCacheRegistry())
    ;(adapter as unknown as { client: unknown }).client = client

    await adapter.generate({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'first' },
        { role: 'user', content: 'fresh' },
      ],
      tools: [{ name: 't', description: 'T', parameters: {} }],
      // `messages` only: the cache resource receives neither the system
      // instruction nor the tools, so both must still go on the wire.
      cache: { messages: 1 },
    })

    const payload = payloads[0]!
    const cfg = payload['config'] as Record<string, unknown>
    assert.ok(cfg['cachedContent'], 'the cached path must be the one under test')
    assert.ok(payload['systemInstruction'], 'system instruction must be sent when it was not cached')
    assert.ok(cfg['tools'], 'tools must be sent when they were not cached')
  })
})

describe('google streaming finish reason', () => {
  it('reports tool_calls for a function-call turn, which Gemini labels STOP', async () => {
    // The agent loop only continues to send tool results back when the finish
    // reason is `tool_calls`; mapping this to `stop` runs the tools and then
    // ends the run without the model ever seeing their results.
    const { client } = fakeGoogleClient([
      { candidates: [{ content: { parts: [{ functionCall: { name: 'search', args: {} } }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    ])
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash')
    ;(adapter as unknown as { client: unknown }).client = client

    const chunks = await collect(adapter.stream({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.find(c => c.type === 'finish') as { finishReason: string } | undefined

    assert.equal(finish?.finishReason, 'tool_calls')
  })

  it('does not claim tool calls for a safety stop', async () => {
    const { client } = fakeGoogleClient([
      { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }] },
    ])
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash')
    ;(adapter as unknown as { client: unknown }).client = client

    const chunks = await collect(adapter.stream({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.find(c => c.type === 'finish') as { finishReason: string } | undefined

    assert.equal(finish?.finishReason, 'content_filter')
    assert.notEqual(finish?.finishReason, 'tool_calls', 'a blocked turn must not send the loop into a tool phase')
  })
})

describe('anthropic splitSystemMessages', () => {
  it('flattens ContentPart[] system content instead of stringifying the array', () => {
    const { system } = splitSystemMessages([
      { role: 'system', content: [{ type: 'text', text: 'You are terse.' }] },
      { role: 'user', content: 'hi' },
    ] as AiMessage[])

    assert.equal(system, 'You are terse.')
    assert.ok(!String(system).includes('[object Object]'), 'system prompt must not be "[object Object]"')
  })
})

describe('openai streaming', () => {
  function adapterWithStream(chunks: unknown[]) {
    let sent: Record<string, unknown> | undefined
    const adapter = new OpenAIProvider({ apiKey: 'k' }).create('gpt-4o') as unknown as {
      getClient: () => Promise<unknown>
      stream: (o: unknown) => AsyncIterable<StreamChunk>
    }
    adapter.getClient = async () => ({
      chat: {
        completions: {
          create: async (params: Record<string, unknown>) => {
            sent = params
            return (async function* () { for (const c of chunks) yield c })()
          },
        },
      },
    })
    return { adapter, sentParams: () => sent }
  }

  it('opts in to usage and reports it from the trailing usage-only chunk', async () => {
    const { adapter, sentParams } = adapterWithStream([
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      // OpenAI sends usage last, on a chunk carrying no choices at all.
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } },
    ])

    const chunks = await collect(adapter.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    assert.deepEqual(
      sentParams()?.['stream_options'],
      { include_usage: true },
      'without this OpenAI never sends usage for a streamed call',
    )

    const finish = chunks.find(c => c.type === 'finish') as { usage?: { totalTokens: number } } | undefined
    assert.ok(finish, 'a finish chunk must still be emitted')
    assert.ok(finish.usage, 'finish chunk must carry the usage from the trailing chunk')
    assert.equal(finish.usage.totalTokens, 16)
  })

  it('reports a truncated turn as length rather than a clean stop', async () => {
    const { adapter } = adapterWithStream([
      { choices: [{ delta: { content: 'half an ans' }, finish_reason: 'length' }] },
    ])

    const chunks = await collect(adapter.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const finish = chunks.find(c => c.type === 'finish') as { finishReason: string } | undefined

    assert.equal(finish?.finishReason, 'length')
  })
})
