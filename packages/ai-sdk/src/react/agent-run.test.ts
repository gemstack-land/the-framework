import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendAgentOutput,
  executeClientTools,
  driveAgentRun,
  type AgentRunOutput,
  type AgentRunRequest,
} from './agent-run.js'
import type { ToolCall } from '../types.js'

// The React hook (`useAgentRun`) is a thin wrapper over the pieces here —
// same posture as a runtime-agnostic seed helper vs its React hook wrapper.
// The framework ships no React testing harness, so we exhaustively cover the
// transcript reducer, the client-tool batch, and the run/resume driver here.

// ─── SSE Response helper ──────────────────────────────────

function sse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')
  return new Response(body, { status: 200 })
}

const toolCall = (id: string, name: string, args: Record<string, unknown> = {}): ToolCall =>
  ({ id, name, arguments: args })

// ─── appendAgentOutput ────────────────────────────────────

describe('appendAgentOutput', () => {
  it('coalesces consecutive text deltas into one growing entry', () => {
    let out: AgentRunOutput[] = []
    out = appendAgentOutput(out, 'text', { text: 'Hel' })
    out = appendAgentOutput(out, 'text', { text: 'lo' })
    assert.deepEqual(out, [{ type: 'text', text: 'Hello' }])
  })

  it('starts a new text entry after a non-text entry interrupts', () => {
    let out: AgentRunOutput[] = []
    out = appendAgentOutput(out, 'text', { text: 'a' })
    out = appendAgentOutput(out, 'tool_call', { id: 't1', tool: 'search', input: { q: 'x' } })
    out = appendAgentOutput(out, 'text', { text: 'b' })
    assert.deepEqual(out.map(o => o.type), ['text', 'tool_call', 'text'])
    assert.deepEqual(out[2], { type: 'text', text: 'b' })
  })

  it('maps approval + handoff + tool_result + error events to entries', () => {
    let out: AgentRunOutput[] = []
    out = appendAgentOutput(out, 'tool_result', { toolCallId: 't1', tool: 'search', content: '3 hits' })
    out = appendAgentOutput(out, 'tool_approval_required', { toolCall: toolCall('t2', 'delete'), isClientTool: false })
    out = appendAgentOutput(out, 'handoff', { from: 'Triage', to: 'Sales', message: 'over to you' })
    out = appendAgentOutput(out, 'error', { message: 'boom' })
    assert.deepEqual(out.map(o => o.type), ['tool_result', 'approval_request', 'handoff', 'error'])
    assert.equal((out[0] as { id?: string }).id, 't1')
    assert.equal((out[1] as { toolCall: ToolCall }).toolCall.id, 't2')
  })

  it('produces no entry for empty text or unknown events', () => {
    assert.deepEqual(appendAgentOutput([], 'text', { text: '' }), [])
    assert.deepEqual(appendAgentOutput([], 'complete', { done: true }), [])
    assert.deepEqual(appendAgentOutput([], 'pending_client_tools', { toolCalls: [] }), [])
  })
})

// ─── executeClientTools ───────────────────────────────────

describe('executeClientTools', () => {
  it('resolves each call in order, keyed by toolCallId', async () => {
    const calls = [toolCall('a', 'one'), toolCall('b', 'two')]
    const results = await executeClientTools(calls, c => `ran:${c.name}`)
    assert.deepEqual(results, [
      { toolCallId: 'a', result: 'ran:one' },
      { toolCallId: 'b', result: 'ran:two' },
    ])
  })

  it('captures a resolver throw as an { error } result without aborting the batch', async () => {
    const calls = [toolCall('a', 'bad'), toolCall('b', 'ok')]
    const results = await executeClientTools(calls, c => {
      if (c.name === 'bad') throw new Error('nope')
      return 'fine'
    })
    assert.deepEqual(results[0], { toolCallId: 'a', result: { error: 'nope' } })
    assert.deepEqual(results[1], { toolCallId: 'b', result: 'fine' })
  })
})

// ─── driveAgentRun ────────────────────────────────────────

describe('driveAgentRun', () => {
  const ctrl = () => new AbortController()

  it('streams a simple run to completion', async () => {
    const turn = await driveAgentRun(
      { type: 'run', input: 'hi' },
      {
        request: async () => sse([
          { event: 'text', data: { text: 'done' } },
          { event: 'complete', data: { done: true, finishReason: 'stop', steps: 1 } },
        ]),
        signal: ctrl().signal,
      },
    )
    assert.equal(turn.done, true)
    assert.equal(turn.awaiting, undefined)
    assert.equal(turn.assistantText, 'done')
  })

  it('auto-resumes across a client-tool pause when a resolver is set', async () => {
    const requests: AgentRunRequest[] = []
    const pending = toolCall('c1', 'get_location', {})

    const turn = await driveAgentRun(
      { type: 'run', input: 'where am i' },
      {
        request: async (req) => {
          requests.push(req)
          if (req.type === 'run') {
            return sse([
              { event: 'pending_client_tools', data: { toolCalls: [pending] } },
              { event: 'complete', data: { done: false, awaiting: 'client_tools' } },
            ])
          }
          // resume → finish
          return sse([
            { event: 'text', data: { text: 'You are in Berlin.' } },
            { event: 'complete', data: { done: true, finishReason: 'stop' } },
          ])
        },
        clientTools: () => ({ lat: 52.5, lon: 13.4 }),
        signal: ctrl().signal,
      },
    )

    assert.equal(requests.length, 2)
    assert.equal(requests[0]!.type, 'run')
    const resume = requests[1]!
    assert.equal(resume.type, 'resume')
    assert.deepEqual(
      resume.type === 'resume' ? resume.clientToolResults : null,
      [{ toolCallId: 'c1', result: { lat: 52.5, lon: 13.4 } }],
    )
    assert.equal(turn.done, true)
    assert.equal(turn.assistantText, 'You are in Berlin.')
  })

  it('parks on a client-tool pause when NO resolver is set', async () => {
    let calls = 0
    const pending = toolCall('c1', 'pick_file')
    const turn = await driveAgentRun(
      { type: 'run', input: 'x' },
      {
        request: async () => {
          calls++
          return sse([
            { event: 'pending_client_tools', data: { toolCalls: [pending] } },
            { event: 'complete', data: { done: false, awaiting: 'client_tools' } },
          ])
        },
        signal: ctrl().signal,
      },
    )
    assert.equal(calls, 1)
    assert.equal(turn.awaiting, 'client_tools')
    assert.deepEqual(turn.pendingClientTools, [pending])
  })

  it('always parks on an approval pause, even with a resolver', async () => {
    let calls = 0
    const turn = await driveAgentRun(
      { type: 'run', input: 'delete everything' },
      {
        request: async () => {
          calls++
          return sse([
            { event: 'tool_approval_required', data: { toolCall: toolCall('t1', 'delete'), isClientTool: false } },
            { event: 'complete', data: { done: false, awaiting: 'approval' } },
          ])
        },
        clientTools: () => 'never called',
        signal: ctrl().signal,
      },
    )
    assert.equal(calls, 1)
    assert.equal(turn.awaiting, 'approval')
    assert.equal(turn.pendingApproval?.toolCall.id, 't1')
  })

  it('throws on a non-ok response', async () => {
    await assert.rejects(
      () => driveAgentRun(
        { type: 'run', input: 'x' },
        { request: async () => new Response('nope', { status: 500 }), signal: ctrl().signal },
      ),
      /status 500/,
    )
  })

  it('forwards onAppEvent from callbacks to the stream reader', async () => {
    const appEvents: Array<{ event: string; data: unknown }> = []
    await driveAgentRun(
      { type: 'run', input: 'hi' },
      {
        request: async () => sse([
          { event: 'run_started', data: { runId: 'r1' } },
          { event: 'text', data: { text: 'done' } },
          { event: 'complete', data: { done: true, finishReason: 'stop' } },
        ]),
        callbacks: {
          onAppEvent: (event, data) => appEvents.push({ event, data }),
        },
        signal: ctrl().signal,
      },
    )
    assert.deepEqual(appEvents, [{ event: 'run_started', data: { runId: 'r1' } }])
  })
})
