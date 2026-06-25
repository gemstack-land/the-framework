import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { toolDefinition } from './tool.js'
import { InMemorySubAgentRunStore } from './sub-agent-run-store.js'
import type { ToolCall } from './types.js'

// ─── Fixtures ─────────────────────────────────────────────

// No `execute` ⇒ a client tool, so a model call that invokes it pauses.
const lookupClientTool = toolDefinition({
  name:        'lookup',
  description: 'Look something up in the browser.',
  inputSchema: z.object({ q: z.string() }),
})

class ResearchSub extends Agent {
  instructions() { return 'You research with a client lookup.' }
  tools() { return [lookupClientTool] }
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

// ─── Tests ─────────────────────────────────────────────────

describe('Agent.resumeManyAsTool', () => {
  let fake: AiFake
  let runStore: InMemorySubAgentRunStore

  beforeEach(() => {
    fake = AiFake.fake()
    runStore = new InMemorySubAgentRunStore()
  })

  it('resumes every snapshot to completion (parallel) and reports allCompleted', async () => {
    await seedPause(runStore, 'r1', 'c1')
    await seedPause(runStore, 'r2', 'c2')
    fake.respondWith('done')

    const batch = await Agent.resumeManyAsTool(
      [
        { subRunId: 'r1', agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'one' },
        { subRunId: 'r2', agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c2', result: 'b' }], key: 'two' },
      ],
      { runStore },
    )

    assert.equal(batch.allCompleted, true)
    assert.equal(batch.completed.length, 2)
    assert.equal(batch.paused.length, 0)
    assert.deepStrictEqual(batch.pendingToolCallIds, [])
    assert.deepStrictEqual(batch.completed.map(c => c.key).sort(), ['one', 'two'])
    assert.equal(batch.completed.every(c => c.response.text === 'done'), true)
  })

  it('aggregates pending tool calls across a mixed completed + paused batch (serial)', async () => {
    await seedPause(runStore, 'r1', 'c1')
    await seedPause(runStore, 'r2', 'c2')
    // Serial → deterministic sequence consumption: r1 completes, r2 pauses again.
    fake.respondWithSequence([
      { text: 'r1 done' },
      { toolCalls: [{ id: 'c2-next', name: 'lookup', arguments: { q: 'again' } }] },
    ])

    const batch = await Agent.resumeManyAsTool(
      [
        { subRunId: 'r1', agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'one' },
        { subRunId: 'r2', agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c2', result: 'b' }], key: 'two' },
      ],
      { runStore, concurrency: 'serial' },
    )

    assert.equal(batch.allCompleted, false)
    assert.equal(batch.completed.length, 1)
    assert.equal(batch.completed[0]!.key, 'one')
    assert.equal(batch.paused.length, 1)
    const paused = batch.paused[0]!
    assert.equal(paused.key, 'two')
    assert.equal(paused.originalSubRunId, 'r2')
    assert.notEqual(paused.subRunId, 'r2')           // fresh id for the next round-trip
    assert.deepStrictEqual(paused.pendingToolCallIds, ['c2-next'])
    // The combined single-round-trip set the host gathers results for next.
    assert.deepStrictEqual(batch.pendingToolCallIds, ['c2-next'])
  })

  it('captures per-item errors by default and still resumes the rest', async () => {
    await seedPause(runStore, 'good', 'c1')
    fake.respondWith('ok')

    const batch = await Agent.resumeManyAsTool(
      [
        { subRunId: 'good',    agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }], key: 'good' },
        { subRunId: 'missing', agent: new ResearchSub(), clientToolResults: [], key: 'missing' },
      ],
      { runStore },
    )

    assert.equal(batch.completed.length, 1)
    assert.equal(batch.completed[0]!.key, 'good')
    assert.equal(batch.errors.length, 1)
    assert.equal(batch.errors[0]!.key, 'missing')
    assert.match(batch.errors[0]!.error.message, /expired or never existed/)
    assert.equal(batch.allCompleted, false)
  })

  it('onError: throw rejects the whole batch on the first bad item', async () => {
    await seedPause(runStore, 'good', 'c1')
    fake.respondWith('ok')

    await assert.rejects(
      () => Agent.resumeManyAsTool(
        [
          { subRunId: 'missing', agent: new ResearchSub(), clientToolResults: [] },
          { subRunId: 'good',    agent: new ResearchSub(), clientToolResults: [{ toolCallId: 'c1', result: 'a' }] },
        ],
        { runStore, onError: 'throw', concurrency: 'serial' },
      ),
      /expired or never existed/,
    )
  })

  it('forwards approval decisions per item', async () => {
    // Seed an approval-kind pause.
    await runStore.store('appr', {
      messages: [
        { role: 'user', content: 'delete it' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a1', name: 'lookup', arguments: { q: 'z' } }] as ToolCall[] },
      ],
      pendingToolCallIds:      ['a1'],
      stepsSoFar:              1,
      tokensSoFar:             5,
      pauseKind:               'approval',
      pendingApprovalToolCall: { toolCall: { id: 'a1', name: 'lookup', arguments: { q: 'z' } }, isClientTool: true },
    })
    fake.respondWith('approved & done')

    const batch = await Agent.resumeManyAsTool(
      [{ subRunId: 'appr', agent: new ResearchSub(), approvedToolCallIds: ['a1'], key: 'appr' }],
      { runStore },
    )

    assert.equal(batch.allCompleted, true)
    assert.equal(batch.completed.length, 1)
    assert.equal(batch.completed[0]!.response.text, 'approved & done')
  })

  it('an empty batch is vacuously complete', async () => {
    const batch = await Agent.resumeManyAsTool([], { runStore })
    assert.equal(batch.allCompleted, true)
    assert.deepStrictEqual(batch.results, [])
    assert.deepStrictEqual(batch.pendingToolCallIds, [])
  })
})
