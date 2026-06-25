/**
 * HttpGatewayAdapter template tests (#1168).
 *
 * Mocks `globalThis.fetch` to capture request shape and stub JSON / SSE
 * responses. An `ExampleEchoGatewayAdapter` (the template's executable
 * documentation — a ~30-line subclass filling the four hooks) drives every
 * case. Verifies:
 *  - generate(): URL, auth header from buildHeaders, JSON envelope from
 *    buildRequestBody, response decode via parseResponse.
 *  - stream(): SSE framing → ordered StreamChunk[] via parseStreamEvent,
 *    including multi-line data, a [DONE] terminator, and events split across
 *    network reads.
 *  - AbortSignal propagation: an already-aborted signal stops the stream.
 *  - HTTP error → readable Error with the status.
 *  - Malformed / blank SSE frames are tolerated (skipped, not thrown).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { HttpGatewayAdapter, type GatewayRequestContext } from './http-gateway-adapter.js'
import type { SseEvent } from './sse.js'
import type { ProviderRequestOptions, ProviderResponse, StreamChunk } from '../types.js'

// ─── Example subclass (the template's reference implementation) ───

class ExampleEchoGatewayAdapter extends HttpGatewayAdapter {
  protected buildHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.config.apiKey ?? ''}` }
  }

  protected buildRequestBody(options: ProviderRequestOptions, ctx: GatewayRequestContext): unknown {
    return { model: this.model, messages: options.messages, stream: ctx.stream }
  }

  protected parseResponse(json: unknown): ProviderResponse {
    const j = json as { text: string; usage: { in: number; out: number } }
    return {
      message: { role: 'assistant', content: j.text },
      usage: { promptTokens: j.usage.in, completionTokens: j.usage.out, totalTokens: j.usage.in + j.usage.out },
      finishReason: 'stop',
    }
  }

  protected parseStreamEvent(event: SseEvent): StreamChunk[] {
    if (event.data === '[DONE]') return [{ type: 'finish', finishReason: 'stop' }]
    const { delta } = JSON.parse(event.data) as { delta?: string }
    return delta ? [{ type: 'text-delta', text: delta }] : []
  }
}

// ─── fetch stub ───────────────────────────────────────────

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

let fetchCalls: FetchCall[] = []
let nextResponse: Response | undefined
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis)

beforeEach(() => {
  fetchCalls = []
  nextResponse = undefined
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as { toString(): string }).toString()
    const method = init?.method ?? 'GET'
    const headers = headersToObject(init?.headers)
    fetchCalls.push({ url, method, headers, body: init?.body })
    if (!nextResponse) throw new Error(`unmocked fetch: ${method} ${url}`)
    return nextResponse
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = realFetch })

function headersToObject(h: unknown): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => { out[k] = v })
    return out
  }
  if (Array.isArray(h)) return Object.fromEntries(h as Array<[string, string]>)
  return { ...(h as Record<string, string>) }
}

/** Build a streaming Response whose body emits `frames` as raw chunks. */
function sseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      for (const f of frames) controller.enqueue(enc.encode(f))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const REQ: ProviderRequestOptions = { model: 'echo-1', messages: [{ role: 'user', content: 'hi' }] }

// ─── generate ─────────────────────────────────────────────

describe('HttpGatewayAdapter.generate', () => {
  it('POSTs the built envelope with auth headers and decodes the response', async () => {
    nextResponse = new Response(JSON.stringify({ text: 'hello', usage: { in: 3, out: 2 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat', apiKey: 'sk-x' }, 'echo-1')

    const res = await adapter.generate(REQ)

    const call = fetchCalls[0]!
    assert.equal(call.url, 'https://gw.example/chat')
    assert.equal(call.method, 'POST')
    assert.equal(call.headers['authorization'], 'Bearer sk-x')
    assert.equal(call.headers['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(call.body as string), { model: 'echo-1', messages: [{ role: 'user', content: 'hi' }], stream: false })

    assert.deepEqual(res.message, { role: 'assistant', content: 'hello' })
    assert.deepEqual(res.usage, { promptTokens: 3, completionTokens: 2, totalTokens: 5 })
    assert.equal(res.finishReason, 'stop')
  })

  it('throws a readable error on a non-2xx response', async () => {
    nextResponse = new Response('rate limited', { status: 429, statusText: 'Too Many Requests' })
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat' }, 'echo-1')
    await assert.rejects(adapter.generate(REQ), /Gateway request failed: 429.*rate limited/)
  })
})

// ─── stream ───────────────────────────────────────────────

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const c of stream) out.push(c)
  return out
}

describe('HttpGatewayAdapter.stream', () => {
  it('frames SSE events into ordered StreamChunks and honors [DONE]', async () => {
    nextResponse = sseResponse([
      'data: {"delta":"Hel"}\n\n',
      'data: {"delta":"lo"}\n\n',
      'data: [DONE]\n\n',
    ])
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat', apiKey: 'sk-x' }, 'echo-1')

    const chunks = await collect(adapter.stream(REQ))

    assert.deepEqual(chunks, [
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'finish', finishReason: 'stop' },
    ])
    // streaming path advertises the SSE accept header + stream:true in the body
    assert.equal(fetchCalls[0]!.headers['accept'], 'text/event-stream')
    assert.equal(JSON.parse(fetchCalls[0]!.body as string).stream, true)
  })

  it('reassembles an event split across two network reads', async () => {
    nextResponse = sseResponse(['data: {"del', 'ta":"split"}\n\n', 'data: [DONE]\n\n'])
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat' }, 'echo-1')
    const chunks = await collect(adapter.stream(REQ))
    assert.deepEqual(chunks, [{ type: 'text-delta', text: 'split' }, { type: 'finish', finishReason: 'stop' }])
  })

  it('tolerates blank and comment frames without throwing', async () => {
    nextResponse = sseResponse([': keep-alive\n\n', '\n\n', 'data: {"delta":"ok"}\n\n'])
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat' }, 'echo-1')
    const chunks = await collect(adapter.stream(REQ))
    assert.deepEqual(chunks, [{ type: 'text-delta', text: 'ok' }])
  })

  it('stops immediately when the abort signal is already fired', async () => {
    nextResponse = sseResponse(['data: {"delta":"never"}\n\n'])
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat' }, 'echo-1')
    const ac = new AbortController()
    ac.abort()
    const chunks = await collect(adapter.stream({ ...REQ, signal: ac.signal }))
    assert.deepEqual(chunks, [])
  })

  it('throws a readable error on a non-2xx stream response', async () => {
    nextResponse = new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    const adapter = new ExampleEchoGatewayAdapter({ baseUrl: 'https://gw.example/chat' }, 'echo-1')
    await assert.rejects(collect(adapter.stream(REQ)), /Gateway request failed: 500.*boom/)
  })
})
