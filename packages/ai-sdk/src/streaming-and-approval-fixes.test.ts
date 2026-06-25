// Regression tests for the 2026-05-21 AI streaming/approval fixes:
//   - Phase 2: OpenAI parallel tool-call delta tracking by `index`
//   - Phase 5: resume-approval synthesizes placeholder `tool` messages for
//              unfulfilled siblings so Anthropic doesn't 400 on the next
//              request with "tool_use must have matching tool_result"

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { Agent } from './agent.js'
import { AiRegistry } from './registry.js'
import { toolDefinition } from './tool.js'
import { resumePendingToolCalls } from './resume-approval.js'
import type {
  AiMessage,
  AnyTool,
  ProviderAdapter,
  ProviderFactory,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolCall,
} from './types.js'

// ─── Phase 2: parallel tool-call args routed by index ──────

/**
 * A provider adapter whose `stream()` consumes one batch of chunks per call.
 * Multi-step agent loops invoke `stream(opts)` once per iteration, so each
 * batch matches one round-trip: a tool-call step (with `finishReason:
 * 'tool_calls'`) is followed by a final text step (with `finishReason:
 * 'stop'`). The chunks are deliberately interleaved across `toolCallIndex`
 * so that "use the last partial" cross-contaminates without Phase 2's fix.
 */
function streamingFakeProvider(batches: StreamChunk[][]): ProviderFactory {
  let call = 0
  const adapter: ProviderAdapter = {
    async generate(): Promise<ProviderResponse> {
      throw new Error('generate not used in streaming tests')
    },
    async *stream(_opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      const batch = batches[call++] ?? []
      for (const c of batch) yield c
    },
  }
  return {
    name:   'fake-stream',
    create: () => adapter,
  }
}

describe('OpenAI parallel tool-call delta routing — Phase 2', () => {
  const searchTool = toolDefinition({
    name:        'search',
    description: 'Search the web.',
    inputSchema: z.object({ q: z.string() }),
  }).server(async (input: { q: string }) => `search:${input.q}`)

  const fetchTool = toolDefinition({
    name:        'fetch_url',
    description: 'Fetch a URL.',
    inputSchema: z.object({ url: z.string() }),
  }).server(async (input: { url: string }) => `fetch:${input.url}`)

  class TwoToolAgent extends Agent {
    instructions() { return 'You call tools.' }
    tools() { return [searchTool, fetchTool] }
    model() { return 'fake-stream/m1' }
  }

  beforeEach(() => AiRegistry.reset())
  afterEach(() => AiRegistry.reset())

  async function drainStream(agent: TwoToolAgent): Promise<{
    response: Awaited<ReturnType<TwoToolAgent['prompt']>>
  }> {
    const { stream, response } = agent.stream('go')
    for await (const _ of stream) { /* drain */ }
    return { response: await response }
  }

  it('args from two parallel tool calls do not cross-contaminate when interleaved by index', async () => {
    // Simulate OpenAI's wire shape — index=0 and index=1 deltas arrive
    // interleaved. The pre-fix agent appended every arg-delta to whichever
    // partial was most recently inserted, so index=1's `{"url":"y"}` would
    // land on index=0's partial after the index=1 start-delta inserted it
    // last, corrupting both argument streams.
    const step0: StreamChunk[] = [
      // Start of tool 0 (search)
      { type: 'tool-call-delta', toolCall: { id: 'call_a', name: 'search' },    toolCallIndex: 0 },
      { type: 'tool-call-delta', text: '{"q":"',  toolCallIndex: 0 },
      // Start of tool 1 (fetch) — interleaved before tool 0's args finish
      { type: 'tool-call-delta', toolCall: { id: 'call_b', name: 'fetch_url' }, toolCallIndex: 1 },
      { type: 'tool-call-delta', text: '{"url":"',    toolCallIndex: 1 },
      // More arg-only fragments — order interleaved across indices
      { type: 'tool-call-delta', text: 'rust"}',      toolCallIndex: 0 },
      { type: 'tool-call-delta', text: 'https://x"}', toolCallIndex: 1 },
      { type: 'finish', finishReason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]
    const step1: StreamChunk[] = [
      { type: 'text-delta', text: 'done' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]
    AiRegistry.register(streamingFakeProvider([step0, step1]))

    const { response } = await drainStream(new TwoToolAgent())

    const allResults = response.steps.flatMap(s => s.toolResults ?? [])
    const byId = new Map(allResults.map(r => [r.toolCallId, r.result]))

    assert.strictEqual(byId.get('call_a'), 'search:rust',          'call_a kept its own q arg')
    assert.strictEqual(byId.get('call_b'), 'fetch:https://x',      'call_b kept its own url arg')
  })

  it('falls back to last-insertion routing when an adapter omits toolCallIndex (back-compat)', async () => {
    // Same chunks without `toolCallIndex` — non-OpenAI streaming adapters
    // (Anthropic, Google) don't track index. With a single tool call there's
    // no ambiguity; we just assert the legacy path still produces correct args.
    const step0: StreamChunk[] = [
      { type: 'tool-call-delta', toolCall: { id: 'call_x', name: 'search' } },
      { type: 'tool-call-delta', text: '{"q":"hello"}' },
      { type: 'finish', finishReason: 'tool_calls', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]
    const step1: StreamChunk[] = [
      { type: 'text-delta', text: 'done' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]
    AiRegistry.register(streamingFakeProvider([step0, step1]))

    const { response } = await drainStream(new TwoToolAgent())
    const allResults = response.steps.flatMap(s => s.toolResults ?? [])
    assert.strictEqual(allResults[0]!.result, 'search:hello')
  })
})

// ─── Phase 5: resume-approval orphan tool_use synthesis ───

describe('resumePendingToolCalls — placeholder synthesis on partial approval', () => {
  let executed: string[]
  const makeTool = (name: string) => toolDefinition({
    name,
    description:   `Run ${name}.`,
    inputSchema:   z.object({}),
    needsApproval: true,
  }).server(async () => { executed.push(name); return `${name}-result` })

  let toolMap: Map<string, AnyTool>
  beforeEach(() => {
    executed = []
    toolMap = new Map<string, AnyTool>([
      ['t0', makeTool('t0')],
      ['t1', makeTool('t1')],
      ['t2', makeTool('t2')],
    ])
  })

  function makeMessages(): AiMessage[] {
    return [
      { role: 'user',      content: 'go' },
      {
        role:      'assistant',
        content:   '',
        toolCalls: [
          { id: 'tc0', name: 't0', arguments: {} },
          { id: 'tc1', name: 't1', arguments: {} },
          { id: 'tc2', name: 't2', arguments: {} },
        ],
      },
    ]
  }

  it('synthesizes placeholders for every unresolved sibling when a tool is still pending', async () => {
    const messages = makeMessages()
    // Approve only tc0; tc1 and tc2 still need user decision.
    const { resumed, approvalStillRequired } = await resumePendingToolCalls({
      messages,
      toolMap,
      options: { approvedToolCallIds: ['tc0'] },
    })

    assert.deepStrictEqual(executed, ['t0'], 'only the approved tool executes')
    assert.strictEqual(approvalStillRequired?.toolCall.id, 'tc1', 'pauses on the first still-pending tool')
    assert.strictEqual(resumed.length, 1, 'only tc0 counts as a real result')

    // Trailing messages: real tc0 result + placeholders for tc1 and tc2.
    const tail = messages.slice(-3)
    assert.strictEqual(tail[0]!.role, 'tool')
    assert.strictEqual(tail[0]!.toolCallId, 'tc0')
    assert.strictEqual(tail[0]!._pending, undefined)

    assert.strictEqual(tail[1]!.toolCallId, 'tc1')
    assert.strictEqual(tail[1]!._pending, true)

    assert.strictEqual(tail[2]!.toolCallId, 'tc2')
    assert.strictEqual(tail[2]!._pending, true)
  })

  it('strips placeholders on resume + re-walks without double-executing resolved tools', async () => {
    const messages = makeMessages()

    // First resume — approve tc0 only.
    await resumePendingToolCalls({ messages, toolMap, options: { approvedToolCallIds: ['tc0'] } })
    assert.deepStrictEqual(executed, ['t0'])

    // User now approves tc1 too; tc2 is rejected.
    const r2 = await resumePendingToolCalls({
      messages,
      toolMap,
      options: { approvedToolCallIds: ['tc0', 'tc1'], rejectedToolCallIds: ['tc2'] },
    })

    assert.deepStrictEqual(executed, ['t0', 't1'], 'tc0 NOT re-executed; tc1 runs; tc2 stays rejected')
    assert.strictEqual(r2.approvalStillRequired, undefined)

    // History tail: assistant + 3 real tool messages (tc0, tc1, tc2), no placeholders.
    const tail = messages.slice(-4)
    assert.strictEqual(tail[0]!.role, 'assistant')
    for (let i = 1; i <= 3; i++) {
      assert.strictEqual(tail[i]!.role, 'tool')
      assert.strictEqual(tail[i]!._pending, undefined, `tail[${i}] must be a real result`)
    }
    assert.strictEqual(tail[3]!.toolCallId, 'tc2')
    const rejection = JSON.parse(tail[3]!.content as string) as { rejected: boolean }
    assert.strictEqual(rejection.rejected, true)
  })

  it('every tool_use in the parent assistant has a matching tool message after partial approval (Anthropic invariant)', async () => {
    const messages = makeMessages()
    await resumePendingToolCalls({ messages, toolMap, options: { approvedToolCallIds: ['tc0'] } })

    const assistant = messages.find(m => m.role === 'assistant')!
    const callIds = (assistant.toolCalls ?? []).map(tc => tc.id)
    const trailingToolIds = messages
      .slice(messages.indexOf(assistant) + 1)
      .filter(m => m.role === 'tool')
      .map(m => m.toolCallId)

    for (const id of callIds) {
      assert.ok(trailingToolIds.includes(id), `tool_use ${id} must have a matching tool message`)
    }
  })
})
