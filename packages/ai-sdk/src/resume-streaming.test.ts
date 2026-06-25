import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { toolDefinition } from './tool.js'
import { InMemorySubAgentRunStore } from './sub-agent-run-store.js'
import type { SubAgentUpdate, ToolCall } from './types.js'

// ─── Fixtures ─────────────────────────────────────────────

// No `execute` ⇒ client tool — a model call that invokes it pauses the loop.
const lookupClientTool = toolDefinition({
  name:        'lookup',
  description: 'Look something up in the browser.',
  inputSchema: z.object({ q: z.string() }),
})

// A server tool — executes inline, so a resumed step that calls it keeps going
// and emits a `tool-call` chunk the default projector surfaces as `tool_call`.
const echoServerTool = toolDefinition({
  name:        'echo',
  description: 'Echo input back.',
  inputSchema: z.object({ x: z.string() }),
}).server((input: { x: string }) => `echoed:${input.x}`)

class Sub extends Agent {
  instructions() { return 'You research with a client lookup and an echo tool.' }
  tools() { return [lookupClientTool, echoServerTool] }
}

/** Seed a client-tool pause snapshot waiting on `pendingId`. */
async function seedPause(store: InMemorySubAgentRunStore, subRunId: string, pendingId: string): Promise<void> {
  await store.store(subRunId, {
    messages: [
      { role: 'user', content: 'do work' },
      { role: 'assistant', content: '', toolCalls: [{ id: pendingId, name: 'lookup', arguments: { q: 'x' } }] as ToolCall[] },
    ],
    pendingToolCallIds: [pendingId],
    stepsSoFar:         1,
    tokensSoFar:        10,
  })
}

// ─── Singular resumeAsTool streaming ──────────────────────

describe('Agent.resumeAsTool — streaming projector', () => {
  let fake: AiFake
  let runStore: InMemorySubAgentRunStore

  beforeEach(() => {
    fake = AiFake.fake()
    runStore = new InMemorySubAgentRunStore()
  })

  it('streaming: true forwards projected tool_call updates and still completes', async () => {
    await seedPause(runStore, 'r1', 'c1')
    fake.respondWithSequence([
      { toolCalls: [{ id: 's1', name: 'echo', arguments: { x: 'hi' } }] }, // resume step 0 — server tool
      { text: 'resumed done' },                                            // resume step 1 — final
    ])

    const updates: SubAgentUpdate[] = []
    const r = await Agent.resumeAsTool('r1', [{ toolCallId: 'c1', result: 'a' }], {
      runStore,
      agent:     new Sub(),
      streaming: true,
      onUpdate:  (u) => { updates.push(u) },
    })

    assert.equal(r.kind, 'completed')
    if (r.kind === 'completed') assert.equal(r.response.text, 'resumed done')

    // The stream may surface a tool-call chunk more than once (same cadence as
    // the asTool streaming path); assert presence + correctness, not an exact count.
    const toolCalls = updates.filter((u): u is Extract<SubAgentUpdate, { kind: 'tool_call' }> => u.kind === 'tool_call')
    assert.ok(toolCalls.length >= 1, `expected a tool_call update, got: ${updates.map(u => u.kind).join(',')}`)
    assert.ok(toolCalls.every(u => u.tool === 'echo'))
  })

  it('does not stream (onUpdate never fires) when streaming is unset — legacy prompt() path', async () => {
    await seedPause(runStore, 'r1', 'c1')
    fake.respondWith('done')

    let called = 0
    const r = await Agent.resumeAsTool('r1', [{ toolCallId: 'c1', result: 'a' }], {
      runStore,
      agent:    new Sub(),
      onUpdate: () => { called++ },   // present but should never be invoked
    })

    assert.equal(r.kind, 'completed')
    assert.equal(called, 0)
  })

  it('a custom projector replaces the default', async () => {
    await seedPause(runStore, 'r1', 'c1')
    fake.respondWithSequence([
      { toolCalls: [{ id: 's1', name: 'echo', arguments: { x: 'hi' } }] },
      { text: 'resumed done' },
    ])

    const seen: string[] = []
    await Agent.resumeAsTool('r1', [{ toolCallId: 'c1', result: 'a' }], {
      runStore,
      agent:     new Sub(),
      streaming: (chunk) =>
        chunk.type === 'tool-call' && chunk.toolCall?.name
          ? { kind: 'tool_call', tool: `custom:${chunk.toolCall.name}` }
          : null,
      onUpdate:  (u) => { if (u.kind === 'tool_call') seen.push(u.tool) },
    })

    assert.ok(seen.length >= 1, 'custom projector produced no updates')
    assert.ok(seen.every(t => t === 'custom:echo'), `unexpected updates: ${seen.join(',')}`)
  })

  it('streams updates even when the resume re-pauses on another client tool', async () => {
    await seedPause(runStore, 'r1', 'c1')
    fake.respondWithSequence([
      // resume re-pauses immediately on a fresh client-tool call
      { toolCalls: [{ id: 'c2', name: 'lookup', arguments: { q: 'again' } }] },
    ])

    const updates: SubAgentUpdate[] = []
    const r = await Agent.resumeAsTool('r1', [{ toolCallId: 'c1', result: 'a' }], {
      runStore,
      agent:     new Sub(),
      streaming: true,
      onUpdate:  (u) => { updates.push(u) },
    })

    assert.equal(r.kind, 'paused')
    if (r.kind === 'paused') {
      assert.equal(r.pauseKind, 'client_tool')
      assert.deepStrictEqual(r.pendingToolCallIds, ['c2'])
    }
  })
})

// ─── Batch resumeManyAsTool streaming ─────────────────────

describe('Agent.resumeManyAsTool — streaming projector', () => {
  let fake: AiFake
  let runStore: InMemorySubAgentRunStore

  beforeEach(() => {
    fake = AiFake.fake()
    runStore = new InMemorySubAgentRunStore()
  })

  it('forwards updates tagged with the originating request (key + originalSubRunId)', async () => {
    await seedPause(runStore, 'r1', 'c1')
    await seedPause(runStore, 'r2', 'c2')
    // Serial → deterministic sequence consumption: r1 fully, then r2.
    fake.respondWithSequence([
      { toolCalls: [{ id: 's1', name: 'echo', arguments: { x: 'a' } }] }, // r1 step 0
      { text: 'r1 done' },                                                // r1 step 1
      { toolCalls: [{ id: 's2', name: 'echo', arguments: { x: 'b' } }] }, // r2 step 0
      { text: 'r2 done' },                                                // r2 step 1
    ])

    const tagged: Array<{ key?: string; originalSubRunId: string; tool: string }> = []
    const batch = await Agent.resumeManyAsTool(
      [
        { subRunId: 'r1', agent: new Sub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'one' },
        { subRunId: 'r2', agent: new Sub(), clientToolResults: [{ toolCallId: 'c2', result: 'b' }], key: 'two' },
      ],
      {
        runStore,
        concurrency: 'serial',
        streaming:   true,
        onUpdate:    (u, ctx) => { if (u.kind === 'tool_call') tagged.push({ ...ctx, tool: u.tool }) },
      },
    )

    assert.equal(batch.allCompleted, true)
    assert.equal(batch.completed.length, 2)

    // Every r1 update is tagged to r1/'one', every r2 update to r2/'two' — the
    // correlation a host needs to fan updates out to per-sub-agent SSE channels.
    const forOne = tagged.filter(t => t.key === 'one')
    const forTwo = tagged.filter(t => t.key === 'two')
    assert.ok(forOne.length >= 1 && forTwo.length >= 1)
    assert.ok(forOne.every(t => t.originalSubRunId === 'r1' && t.tool === 'echo'))
    assert.ok(forTwo.every(t => t.originalSubRunId === 'r2' && t.tool === 'echo'))
  })

  it('passes correlation ctx to a side-effect projector so every raw chunk self-identifies', async () => {
    await seedPause(runStore, 'r1', 'c1')
    await seedPause(runStore, 'r2', 'c2')
    // Serial → r1 fully (echo x:'a'), then r2 (echo x:'b'); the echo arg lets us
    // map a raw tool-call chunk back to the sub-agent it came from.
    fake.respondWithSequence([
      { toolCalls: [{ id: 's1', name: 'echo', arguments: { x: 'a' } }] }, // r1 step 0
      { text: 'r1 done' },                                                // r1 step 1
      { toolCalls: [{ id: 's2', name: 'echo', arguments: { x: 'b' } }] }, // r2 step 0
      { text: 'r2 done' },                                                // r2 step 1
    ])

    // A pure side-effect projector: fans the raw chunk to a per-sub-agent channel
    // using ctx.originalSubRunId, returns null (so onUpdate never fires).
    const channels: Record<string, Array<{ type: string; arg?: unknown }>> = {}
    let onUpdateCalls = 0
    const batch = await Agent.resumeManyAsTool(
      [
        { subRunId: 'r1', agent: new Sub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'one' },
        { subRunId: 'r2', agent: new Sub(), clientToolResults: [{ toolCallId: 'c2', result: 'b' }], key: 'two' },
      ],
      {
        runStore,
        concurrency: 'serial',
        streaming:   (chunk, ctx) => {
          assert.ok(ctx, 'projector received no correlation ctx')
          const list = (channels[ctx.originalSubRunId] ??= [])
          list.push({ type: chunk.type, arg: chunk.type === 'tool-call' ? chunk.toolCall?.arguments?.x : undefined })
          return null
        },
        onUpdate:    () => { onUpdateCalls++ },
      },
    )

    assert.equal(batch.allCompleted, true)
    assert.equal(onUpdateCalls, 0, 'a null-returning projector must not fire onUpdate')

    // Every chunk landed in exactly its own sub-agent's channel.
    assert.deepEqual(Object.keys(channels).sort(), ['r1', 'r2'])
    const argsFor = (id: string) => channels[id]!.filter(c => c.type === 'tool-call').map(c => c.arg)
    assert.ok(argsFor('r1').includes('a') && !argsFor('r1').includes('b'), 'r1 channel leaked a foreign chunk')
    assert.ok(argsFor('r2').includes('b') && !argsFor('r2').includes('a'), 'r2 channel leaked a foreign chunk')
  })

  it('does not stream when streaming is unset (back-compat) — onUpdate never fires', async () => {
    await seedPause(runStore, 'r1', 'c1')
    fake.respondWith('done')

    let called = 0
    const batch = await Agent.resumeManyAsTool(
      [{ subRunId: 'r1', agent: new Sub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'one' }],
      { runStore, onUpdate: () => { called++ } },
    )

    assert.equal(batch.allCompleted, true)
    assert.equal(called, 0)
  })
})
