import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  toAgentSseStream,
  toAgentSseResponse,
  readAgentStream,
  applyAgentSseEvent,
  newAgentStreamTurn,
} from './agent-sse.js'
import type { AgentResponse, AgentStreamResponse, StreamChunk, TokenUsage } from './types.js'

const USAGE: TokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }

function streamOf(chunks: StreamChunk[], response: Partial<AgentResponse> = {}): AgentStreamResponse {
  return {
    stream: (async function* () {
      for (const c of chunks) yield c
    })(),
    response: Promise.resolve({
      text: '',
      steps: [],
      usage: USAGE,
      ...response,
    } as AgentResponse),
  }
}

/** Drain an SSE ReadableStream into its raw text. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

/** Wrap raw SSE text as a Response, optionally chopping the body into N-byte slices. */
function sseResponse(body: string, sliceSize?: number): Response {
  const bytes = new TextEncoder().encode(body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (sliceSize) {
        for (let i = 0; i < bytes.length; i += sliceSize) {
          controller.enqueue(bytes.slice(i, i + sliceSize))
        }
      } else {
        controller.enqueue(bytes)
      }
      controller.close()
    },
  })
  return new Response(stream)
}

describe('toAgentSseStream', () => {
  it('frames text, tool_call, tool_result and a terminal complete', async () => {
    const raw = await drain(toAgentSseStream(streamOf([
      { type: 'text-delta', text: 'Hi ' },
      { type: 'text-delta', text: 'there' },
      { type: 'tool-call', toolCall: { id: 'a', name: 'lookup', arguments: { q: 'x' } } },
      { type: 'tool-result', toolCall: { id: 'a', name: 'lookup' }, result: { hits: 2 } },
    ], { finishReason: 'stop' })))

    assert.match(raw, /event: text\ndata: {"text":"Hi "}\n\n/)
    assert.match(raw, /event: tool_call\ndata: {"id":"a","tool":"lookup","input":{"q":"x"}}\n\n/)
    assert.match(raw, /event: tool_result\ndata: .*"content":"{\\"hits\\":2}".*\n\n/)
    assert.match(raw, /event: complete\ndata: .*"done":true.*\n\n/)
  })

  it('passes a string tool result through verbatim', async () => {
    const raw = await drain(toAgentSseStream(streamOf([
      { type: 'tool-result', toolCall: { id: 'a', name: 't' }, result: 'plain string' },
    ])))
    assert.match(raw, /"content":"plain string"/)
  })

  it('maps a client-tool pause to awaiting=client_tools on complete', async () => {
    const raw = await drain(toAgentSseStream(streamOf([
      { type: 'pending-client-tools', toolCalls: [{ id: 'c', name: 'geo', arguments: {} }] },
    ], { finishReason: 'client_tool_calls' })))
    assert.match(raw, /event: pending_client_tools\n/)
    assert.match(raw, /"awaiting":"client_tools"/)
  })

  it('maps an approval pause to awaiting=approval on complete', async () => {
    const raw = await drain(toAgentSseStream(streamOf([
      { type: 'pending-approval', toolCall: { id: 'd', name: 'delete', arguments: {} }, isClientTool: false },
    ], { finishReason: 'tool_approval_required' })))
    assert.match(raw, /event: tool_approval_required\n/)
    assert.match(raw, /"awaiting":"approval"/)
  })

  it('emits an error event when the response rejects, then closes', async () => {
    const failing: AgentStreamResponse = {
      stream: (async function* () { /* no chunks */ })(),
      response: Promise.reject(new Error('boom')),
    }
    const raw = await drain(toAgentSseStream(failing))
    assert.match(raw, /event: error\ndata: {"message":"boom"}\n\n/)
  })
})

describe('toAgentSseResponse', () => {
  it('sets text/event-stream headers', () => {
    const resp = toAgentSseResponse(streamOf([]))
    assert.equal(resp.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
    assert.match(resp.headers.get('Cache-Control') ?? '', /no-cache/)
    assert.equal(resp.headers.get('X-Accel-Buffering'), 'no')
  })
})

describe('readAgentStream round-trips toAgentSseStream', () => {
  it('decodes a full turn back into accumulated state', async () => {
    const server = toAgentSseStream(streamOf([
      { type: 'text-delta', text: 'Hello ' },
      { type: 'text-delta', text: 'world' },
      { type: 'tool-call', toolCall: { id: 'a', name: 'lookup', arguments: { q: 'x' } } },
      { type: 'tool-result', toolCall: { id: 'a', name: 'lookup' }, result: 'done' },
    ], { finishReason: 'stop', steps: [{} as never, {} as never] }))

    const seen: string[] = []
    const turn = await readAgentStream(new Response(server), {
      onText: t => seen.push(t),
    })

    assert.equal(turn.assistantText, 'Hello world')
    assert.deepStrictEqual(seen, ['Hello ', 'world'])
    assert.deepStrictEqual(turn.assistantToolCalls, [{ id: 'a', name: 'lookup', arguments: { q: 'x' } }])
    assert.equal(turn.serverToolResults.length, 1)
    assert.deepStrictEqual(turn.serverToolResults[0], { role: 'tool', content: 'done', toolCallId: 'a' })
    assert.equal(turn.done, true)
    assert.equal(turn.awaiting, undefined)
  })

  it('surfaces a client-tool pause', async () => {
    const server = toAgentSseStream(streamOf([
      { type: 'pending-client-tools', toolCalls: [{ id: 'c', name: 'geo', arguments: {} }] },
    ], { finishReason: 'client_tool_calls' }))
    const turn = await readAgentStream(new Response(server))
    assert.equal(turn.pendingClientTools.length, 1)
    assert.equal(turn.pendingClientTools[0]!.name, 'geo')
    assert.equal(turn.awaiting, 'client_tools')
  })

  it('surfaces an approval pause', async () => {
    const server = toAgentSseStream(streamOf([
      { type: 'pending-approval', toolCall: { id: 'd', name: 'delete', arguments: {} }, isClientTool: true },
    ], { finishReason: 'tool_approval_required' }))
    const turn = await readAgentStream(new Response(server))
    assert.equal(turn.pendingApproval?.toolCall.name, 'delete')
    assert.equal(turn.pendingApproval?.isClientTool, true)
    assert.equal(turn.awaiting, 'approval')
  })

  it('fires onError for an error event', async () => {
    const failing: AgentStreamResponse = {
      stream: (async function* () {})(),
      response: Promise.reject(new Error('kaboom')),
    }
    let msg = ''
    await readAgentStream(new Response(toAgentSseStream(failing)), {
      onError: e => { msg = e.message },
    })
    assert.equal(msg, 'kaboom')
  })

  it('reassembles a frame split across read boundaries', async () => {
    // One byte at a time forces every SSE frame to span multiple reads.
    const body =
      'event: text\ndata: {"text":"chunked"}\n\n' +
      'event: complete\ndata: {"done":true}\n\n'
    const turn = await readAgentStream(sseResponse(body, 1))
    assert.equal(turn.assistantText, 'chunked')
    assert.equal(turn.done, true)
  })

  it('skips malformed event JSON without throwing', async () => {
    const body =
      'event: text\ndata: {bad json}\n\n' +
      'event: text\ndata: {"text":"ok"}\n\n'
    const turn = await readAgentStream(sseResponse(body))
    assert.equal(turn.assistantText, 'ok')
  })

  it('returns an empty turn for a bodyless response', async () => {
    const turn = await readAgentStream(new Response(null))
    assert.deepStrictEqual(turn, newAgentStreamTurn())
  })
})

describe('applyAgentSseEvent', () => {
  it('accumulates a handoff chain across events', () => {
    const turn = newAgentStreamTurn()
    applyAgentSseEvent('handoff', { from: 'Triage', to: 'Sales' }, turn)
    applyAgentSseEvent('handoff', { from: 'Sales', to: 'Billing' }, turn)
    assert.deepStrictEqual(turn.handoffPath, ['Triage', 'Sales', 'Billing'])
  })

  it('generates a tool-call id when the wire omits one', () => {
    const turn = newAgentStreamTurn()
    applyAgentSseEvent('tool_call', { tool: 'noId', input: {} }, turn)
    assert.equal(turn.assistantToolCalls.length, 1)
    assert.ok(turn.assistantToolCalls[0]!.id.length > 0)
  })

  it('ignores a tool_result with no id', () => {
    const turn = newAgentStreamTurn()
    applyAgentSseEvent('tool_result', { content: 'orphan' }, turn)
    assert.equal(turn.serverToolResults.length, 0)
  })

  it('fires onAppEvent for unknown events and leaves turn state unchanged', () => {
    const turn = newAgentStreamTurn()
    const appEvents: Array<{ event: string; data: unknown }> = []
    applyAgentSseEvent('run_started', { runId: 'abc-123' }, turn, {
      onAppEvent: (event, data) => appEvents.push({ event, data }),
    })
    assert.deepStrictEqual(appEvents, [{ event: 'run_started', data: { runId: 'abc-123' } }])
    // Turn state must be unmodified.
    assert.deepStrictEqual(turn, newAgentStreamTurn())
  })

  it('readAgentStream fires onAppEvent for non-vocabulary events', async () => {
    const body =
      'event: run_started\ndata: {"runId":"xyz"}\n\n' +
      'event: text\ndata: {"text":"hello"}\n\n' +
      'event: complete\ndata: {"done":true}\n\n'
    const appEvents: Array<{ event: string; data: unknown }> = []
    const turn = await readAgentStream(sseResponse(body), {
      onAppEvent: (event, data) => appEvents.push({ event, data }),
    })
    assert.deepStrictEqual(appEvents, [{ event: 'run_started', data: { runId: 'xyz' } }])
    assert.equal(turn.assistantText, 'hello')
    assert.equal(turn.done, true)
  })
})
