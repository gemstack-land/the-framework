import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, agent } from './agent.js'
import { AiFake } from './fake.js'
import { toolDefinition } from './tool.js'
import {
  InMemorySubAgentRunStore,
  CachedSubAgentRunStore,
  type SubAgentRunSnapshot,
  type SubAgentRunStore,
} from './sub-agent-run-store.js'
import { z } from 'zod'
import type { StreamChunk, SubAgentUpdate, ToolCall } from './types.js'

// ─── Test fixtures ────────────────────────────────────────

class ResearchAgent extends Agent {
  instructions() { return 'You are a research assistant.' }
}

// A fixed client tool the sub-agent's model can call. No `execute` ⇒ client tool.
const lookupClientTool = toolDefinition({
  name:        'lookup',
  description: 'Look something up in the browser cache.',
  inputSchema: z.object({ q: z.string() }),
})

class ResearchAgentWithClientTool extends Agent {
  instructions() { return 'You are a research assistant with a client lookup.' }
  tools() { return [lookupClientTool] }
}

// ─── 1. Streaming projection ─────────────────────────────

describe('asTool() — streaming projection', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })

  it('zero-config still produces a single AgentResponse on the parent stream (1.2.0 unchanged)', async () => {
    const sub = new ResearchAgent().asTool({
      name:        'research',
      description: 'Research a topic.',
    })
    const parent = agent({
      instructions: 'You orchestrate.',
      tools:        [sub],
    })

    fake.respondWithSequence([
      // parent step 0 — call research
      { toolCalls: [{ id: 'p1', name: 'research', arguments: { prompt: 'hello' } }] },
      // sub-agent's single-step prompt() — final reply
      { text: 'sub research result' },
      // parent step 1 — final reply
      { text: 'final parent reply' },
    ])
    const r = await parent.prompt('do it')
    assert.equal(r.text, 'final parent reply')
  })

  it('streaming: true emits agent_start + tool_call + agent_done as tool-update chunks', async () => {
    // Sub-agent: 2-step run that calls a server tool then finishes.
    const echoTool = toolDefinition({
      name:        'echo',
      description: 'Echo input back.',
      inputSchema: z.object({ x: z.string() }),
    }).server((input: { x: string }) => `echoed:${input.x}`)

    class StreamingSub extends Agent {
      instructions() { return 'You echo things.' }
      tools() { return [echoTool] }
    }

    const sub = new StreamingSub().asTool({
      name:        'streamer',
      description: 'Streaming sub-agent.',
      streaming:   true,
    })
    const parent = agent({ instructions: 'Parent.', tools: [sub] })

    fake.respondWithSequence([
      // parent step 0 — call the sub-agent
      { toolCalls: [{ id: 'p1', name: 'streamer', arguments: { prompt: 'go' } }] },
      // sub step 0 — call echo
      { toolCalls: [{ id: 's1', name: 'echo', arguments: { x: 'hi' } }] },
      // sub step 1 — final text
      { text: 'sub done' },
      // parent step 1 — final text
      { text: 'all done' },
    ])

    const { stream, response } = parent.stream('go')
    const updates: SubAgentUpdate[] = []
    for await (const chunk of stream) {
      if (chunk.type === 'tool-update' && chunk.update) {
        updates.push(chunk.update as SubAgentUpdate)
      }
    }
    await response

    const kinds = updates.map(u => u.kind)
    assert.ok(kinds.includes('agent_start'),  `missing agent_start: ${kinds.join(',')}`)
    assert.ok(kinds.includes('tool_call'),    `missing tool_call: ${kinds.join(',')}`)
    assert.ok(kinds.includes('agent_done'),   `missing agent_done: ${kinds.join(',')}`)

    const toolCallUpdate = updates.find(u => u.kind === 'tool_call') as { kind: 'tool_call'; tool: string }
    assert.equal(toolCallUpdate.tool, 'echo')
  })

  it('custom predicate replaces the default projector', async () => {
    fake.respondWithSequence([
      { toolCalls: [{ id: 'p1', name: 'streamer', arguments: { prompt: 'go' } }] },
      { text: 'sub done' },
      { text: 'parent done' },
    ])

    let predicateCallCount = 0
    const sub = new ResearchAgent().asTool({
      name:        'streamer',
      description: 'Streaming sub-agent.',
      streaming: (chunk: StreamChunk): SubAgentUpdate | null => {
        predicateCallCount++
        if (chunk.type === 'finish') return { kind: 'agent_done', steps: 1, tokens: 0 }
        return null
      },
    })
    const parent = agent({ instructions: 'Parent.', tools: [sub] })
    const { stream, response } = parent.stream('go')
    for await (const _ of stream) { void _ }
    await response
    assert.ok(predicateCallCount > 0, 'custom predicate must be invoked at least once')
  })
})

// ─── 2. Suspend flow ─────────────────────────────────────

describe('asTool() — suspend on client tool', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })

  it('builder throws when suspendable is set without streaming', () => {
    const runStore = new InMemorySubAgentRunStore()
    assert.throws(
      () => new ResearchAgent().asTool({
        name:        'r',
        description: 'd',
        suspendable: { runStore },
      }),
      /requires `streaming/,
    )
  })

  it('suspends the parent loop and persists the inner snapshot when sub-agent calls a client tool', async () => {
    const runStore = new InMemorySubAgentRunStore()

    // Spy: capture the snapshot store() received.
    let storedSubRunId: string | undefined
    let storedSnapshot: SubAgentRunSnapshot | undefined
    const spy: SubAgentRunStore = {
      async store(id, snap) { storedSubRunId = id; storedSnapshot = snap; await runStore.store(id, snap) },
      async consume(id)         { return runStore.consume(id) },
    }

    const sub = new ResearchAgentWithClientTool().asTool({
      name:        'researcher',
      description: 'Sub-agent that may call a client tool.',
      streaming:   true,
      suspendable: { runStore: spy },
    })
    const parent = agent({ instructions: 'Parent.', tools: [sub] })

    fake.respondWithSequence([
      // parent step 0 — call the sub
      { toolCalls: [{ id: 'p1', name: 'researcher', arguments: { prompt: 'go' } }] },
      // sub step 0 — model calls the lookup CLIENT tool
      { toolCalls: [{ id: 'c1', name: 'lookup', arguments: { q: 'capital of france' } }] },
    ])

    const { stream, response } = parent.stream('go')
    const updates: SubAgentUpdate[] = []
    for await (const chunk of stream) {
      if (chunk.type === 'tool-update' && chunk.update) {
        updates.push(chunk.update as SubAgentUpdate)
      }
    }
    const r = await response

    // Parent loop halted on the inner client tool.
    assert.equal(r.finishReason, 'client_tool_calls', `parent should halt; got ${r.finishReason}`)
    const pending = r.pendingClientToolCalls ?? []
    assert.equal(pending.length, 1, 'parent surfaces inner pending')
    assert.equal(pending[0]!.name, 'lookup')

    // store() called exactly once with a usable snapshot.
    assert.ok(storedSubRunId,     'runStore.store should have been called')
    assert.ok(storedSnapshot,     'snapshot should be defined')
    assert.deepStrictEqual(storedSnapshot!.pendingToolCallIds, ['c1'])
    assert.ok(storedSnapshot!.messages.length >= 2, 'snapshot carries user + assistant messages')
    assert.equal(storedSnapshot!.messages[0]!.role, 'user')
    assert.equal(storedSnapshot!.messages[0]!.content, 'go')

    // subagent_paused update emitted with the same id.
    const pausedUpdate = updates.find(u => u.kind === 'subagent_paused') as
      | { kind: 'subagent_paused'; subRunId: string; pendingToolCallIds: string[] }
      | undefined
    assert.ok(pausedUpdate, 'subagent_paused update emitted')
    assert.equal(pausedUpdate!.subRunId, storedSubRunId)

    // The runStore consume() round-trips back to an equivalent snapshot.
    const restored = await runStore.consume(storedSubRunId!)
    assert.ok(restored)
    assert.deepStrictEqual(restored!.pendingToolCallIds, storedSnapshot!.pendingToolCallIds)
  })
})

// ─── 3. Resume flow ──────────────────────────────────────

describe('Agent.resumeAsTool', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })

  it('completed path — appends tool result, runs to completion, returns AgentResponse', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new ResearchAgentWithClientTool()

    const subRunId = 'test-run-1'
    await runStore.store(subRunId, {
      messages: [
        { role: 'user', content: 'capital of france?' },
        // assistant turn that requested a client tool
        {
          role:      'assistant',
          content:   '',
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: { q: 'paris' } }] as ToolCall[],
        },
      ],
      pendingToolCallIds: ['c1'],
      stepsSoFar:         1,
      tokensSoFar:        20,
    })

    fake.respondWith('the answer is paris')

    const r = await Agent.resumeAsTool(
      subRunId,
      [{ toolCallId: 'c1', result: { city: 'Paris' } }],
      { runStore, agent: subAgent },
    )
    assert.equal(r.kind, 'completed')
    if (r.kind !== 'completed') return
    assert.equal(r.response.text, 'the answer is paris')

    // consume() was atomic — second resume on the same id throws.
    await assert.rejects(
      () => Agent.resumeAsTool(subRunId, [], { runStore, agent: subAgent }),
      /expired or never existed/,
    )
  })

  it('paused-again path — sub-agent calls another client tool; resume returns { kind: paused } with a fresh subRunId', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new ResearchAgentWithClientTool()

    const firstSubRunId = 'first-run'
    await runStore.store(firstSubRunId, {
      messages: [
        { role: 'user', content: 'do work' },
        {
          role:      'assistant',
          content:   '',
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: { q: 'a' } }] as ToolCall[],
        },
      ],
      pendingToolCallIds: ['c1'],
      stepsSoFar:         1,
      tokensSoFar:        10,
    })

    // Resume run: model calls another client tool instead of finishing.
    fake.respondWithSequence([
      { toolCalls: [{ id: 'c2', name: 'lookup', arguments: { q: 'b' } }] },
    ])

    const r = await Agent.resumeAsTool(
      firstSubRunId,
      [{ toolCallId: 'c1', result: 'first-tool-result' }],
      { runStore, agent: subAgent },
    )
    assert.equal(r.kind, 'paused')
    if (r.kind !== 'paused') return
    assert.notEqual(r.subRunId, firstSubRunId, 'fresh subRunId returned for next round-trip')
    assert.deepStrictEqual(r.pendingToolCallIds, ['c2'])

    // The new snapshot is in the store and consumable.
    const restored = await runStore.consume(r.subRunId)
    assert.ok(restored)
    assert.deepStrictEqual(restored!.pendingToolCallIds, ['c2'])
    assert.equal(restored!.stepsSoFar, 2, 'stepsSoFar accumulates across suspends (1 prior + 1 fresh)')
    assert.ok(restored!.messages.length >= 3, 'snapshot includes the original user msg + first call + first result + second call')
  })

  it('forgery guard — throws when an incoming toolCallId is not in the pending set', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new ResearchAgentWithClientTool()

    await runStore.store('r1', {
      messages: [{ role: 'user', content: 'x' }],
      pendingToolCallIds: ['c1'],
      stepsSoFar: 0,
      tokensSoFar: 0,
    })

    await assert.rejects(
      () => Agent.resumeAsTool(
        'r1',
        [{ toolCallId: 'WRONG', result: 'hijacked' }],
        { runStore, agent: subAgent },
      ),
      /not in the pending set/,
    )
  })

  it('rejects missing snapshot with a clear error', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new ResearchAgentWithClientTool()
    await assert.rejects(
      () => Agent.resumeAsTool('does-not-exist', [], { runStore, agent: subAgent }),
      /expired or never existed/,
    )
  })
})

// ─── 4. SubAgentRunStore round-trip ──────────────────────

describe('CachedSubAgentRunStore', () => {
  it('round-trips a snapshot through an injected cache adapter', async () => {
    const data = new Map<string, unknown>()
    const stub = {
      async get<T = unknown>(k: string) { return (data.get(k) as T | undefined) ?? null },
      async set(k: string, v: unknown)  { data.set(k, v) },
      async forget(k: string)           { data.delete(k) },
    }

    const store = new CachedSubAgentRunStore({ cache: stub, ttlSeconds: 60, keyPrefix: 'test:' })

    const snapshot: SubAgentRunSnapshot = {
      messages:           [{ role: 'user', content: 'hi' }],
      pendingToolCallIds: ['c1'],
      stepsSoFar:         1,
      tokensSoFar:        15,
    }

    await store.store('r1', snapshot)
    assert.ok(data.has('test:r1'), 'cache write keyed under the configured prefix')

    const restored = await store.consume('r1')
    assert.deepStrictEqual(restored, snapshot)

    // Atomic — second consume returns null.
    const second = await store.consume('r1')
    assert.equal(second, null)
  })
})

describe('InMemorySubAgentRunStore', () => {
  it('atomic consume — second call returns null', async () => {
    const store = new InMemorySubAgentRunStore()
    const snapshot: SubAgentRunSnapshot = {
      messages: [], pendingToolCallIds: [], stepsSoFar: 0, tokensSoFar: 0,
    }
    await store.store('r', snapshot)
    assert.deepStrictEqual(await store.consume('r'), snapshot)
    assert.equal(await store.consume('r'), null)
  })

  it('clear() removes all snapshots without consuming', async () => {
    const store = new InMemorySubAgentRunStore()
    await store.store('a', { messages: [], pendingToolCallIds: [], stepsSoFar: 0, tokensSoFar: 0 })
    await store.store('b', { messages: [], pendingToolCallIds: [], stepsSoFar: 0, tokensSoFar: 0 })
    store.clear()
    assert.equal(await store.consume('a'), null)
    assert.equal(await store.consume('b'), null)
  })
})
