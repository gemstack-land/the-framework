import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { toolDefinition } from './tool.js'
import { InMemorySubAgentRunStore } from './sub-agent-run-store.js'
import { z } from 'zod'
import type { ToolCall } from './types.js'

// ─── Test fixtures ────────────────────────────────────────

let executions = 0
const dangerousTool = toolDefinition({
  name:          'delete_record',
  description:   'Delete a record (gated).',
  inputSchema:   z.object({ id: z.string() }),
  needsApproval: true,
}).server(async () => { executions++; return 'deleted' })

class GuardedAgent extends Agent {
  instructions() { return 'You delete things, with approval.' }
  tools() { return [dangerousTool] }
}

const baseSnapshotMessages = (gatedId: string, recordId: string) => [
  { role: 'user' as const, content: 'delete user' },
  {
    role:      'assistant' as const,
    content:   '',
    toolCalls: [{ id: gatedId, name: 'delete_record', arguments: { id: recordId } }] as ToolCall[],
  },
]

// ─── Resume on approval pauses ────────────────────────────

describe('Agent.resumeAsTool — approval pauses', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake(); executions = 0 })

  it('approve path — runs the gated tool to completion and returns AgentResponse', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    const subRunId = 'apv-1'
    await runStore.store(subRunId, {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             20,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    fake.respondWith('record deleted')

    const r = await Agent.resumeAsTool(
      subRunId,
      [],
      { runStore, agent: subAgent, approvedToolCallIds: ['inner-1'] },
    )

    assert.equal(r.kind, 'completed')
    if (r.kind !== 'completed') return
    assert.equal(r.response.text, 'record deleted')
    assert.equal(executions, 1, 'gated tool must execute exactly once after approval')

    // consume() was atomic — second resume on the same id throws.
    await assert.rejects(
      () => Agent.resumeAsTool(subRunId, [], { runStore, agent: subAgent, approvedToolCallIds: ['inner-1'] }),
      /expired or never existed/,
    )
  })

  it('reject path — does NOT execute the gated tool and returns the rejection-aware response', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    await runStore.store('apv-r', {
      messages:                baseSnapshotMessages('inner-r', '99'),
      pendingToolCallIds:      ['inner-r'],
      stepsSoFar:              1,
      tokensSoFar:             20,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-r', name: 'delete_record', arguments: { id: '99' } },
        isClientTool: false,
      },
    })

    fake.respondWith('not deleting')

    const r = await Agent.resumeAsTool(
      'apv-r',
      [],
      { runStore, agent: subAgent, rejectedToolCallIds: ['inner-r'] },
    )

    assert.equal(r.kind, 'completed')
    assert.equal(executions, 0, 'rejected tool must not execute')
  })

  it('pause-again path — gated tool approval triggers another approval gate; resume returns paused with pauseKind=approval', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    await runStore.store('apv-2', {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             10,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    // After approving inner-1, the sub-agent's next step issues ANOTHER
    // gated tool call — the loop must halt again on approval.
    fake.respondWithSequence([
      { toolCalls: [{ id: 'inner-2', name: 'delete_record', arguments: { id: '8' } }] },
    ])

    const r = await Agent.resumeAsTool(
      'apv-2',
      [],
      { runStore, agent: subAgent, approvedToolCallIds: ['inner-1'] },
    )

    assert.equal(r.kind, 'paused')
    if (r.kind !== 'paused') return
    assert.equal(r.pauseKind, 'approval')
    assert.notEqual(r.subRunId, 'apv-2', 'fresh subRunId returned for next round-trip')
    assert.deepStrictEqual(r.pendingToolCallIds, ['inner-2'])
    assert.equal(r.toolCall?.id, 'inner-2')
    assert.equal(r.isClientTool, false)

    // The new snapshot is in the store with the approval discriminator
    // and accumulates step counts across suspends.
    const restored = await runStore.consume(r.subRunId)
    assert.ok(restored)
    assert.equal(restored!.pauseKind, 'approval')
    assert.deepStrictEqual(restored!.pendingToolCallIds, ['inner-2'])
    assert.equal(restored!.stepsSoFar, 2, 'stepsSoFar accumulates across suspends')
    assert.equal(restored!.pendingApprovalToolCall?.toolCall.id, 'inner-2')
    // The first approval execute() actually ran — confirms approval was wired through.
    assert.equal(executions, 1)
  })

  it('rejects clientToolResults on an approval snapshot', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    await runStore.store('apv-bad', {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             10,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    await assert.rejects(
      () => Agent.resumeAsTool(
        'apv-bad',
        [{ toolCallId: 'inner-1', result: 'wrong-shape' }],
        { runStore, agent: subAgent, approvedToolCallIds: ['inner-1'] },
      ),
      /clientToolResults was non-empty/,
    )
  })

  it('rejects when neither approved nor rejected ids are supplied', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    await runStore.store('apv-empty', {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             10,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    await assert.rejects(
      () => Agent.resumeAsTool('apv-empty', [], { runStore, agent: subAgent }),
      /requires `approvedToolCallIds` or `rejectedToolCallIds`/,
    )
  })

  it('rejects approvedToolCallId that is not in the pending set', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new GuardedAgent()

    await runStore.store('apv-forge', {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             10,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    await assert.rejects(
      () => Agent.resumeAsTool(
        'apv-forge',
        [],
        { runStore, agent: subAgent, approvedToolCallIds: ['DIFFERENT-ID'] },
      ),
      /approvedToolCallId "DIFFERENT-ID" was not in the pending set/,
    )
  })
})

// ─── Cross-kind resume — approve, then pause on a client tool ─

describe('Agent.resumeAsTool — cross-kind transitions', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake(); executions = 0 })

  it('approval snapshot → pauses on a client tool: returns paused with pauseKind=client_tool', async () => {
    const lookupClientTool = toolDefinition({
      name:        'lookup',
      description: 'browser lookup',
      inputSchema: z.object({ q: z.string() }),
    })

    class MixedAgent extends Agent {
      instructions() { return 'mixed' }
      tools() { return [dangerousTool, lookupClientTool] }
    }

    const runStore = new InMemorySubAgentRunStore()
    const subAgent = new MixedAgent()

    await runStore.store('apv-x', {
      messages:                baseSnapshotMessages('inner-1', '7'),
      pendingToolCallIds:      ['inner-1'],
      stepsSoFar:              1,
      tokensSoFar:             10,
      pauseKind:               'approval',
      pendingApprovalToolCall: {
        toolCall:     { id: 'inner-1', name: 'delete_record', arguments: { id: '7' } },
        isClientTool: false,
      },
    })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'cli-1', name: 'lookup', arguments: { q: 'next' } }] },
    ])

    const r = await Agent.resumeAsTool(
      'apv-x',
      [],
      { runStore, agent: subAgent, approvedToolCallIds: ['inner-1'] },
    )

    assert.equal(r.kind, 'paused')
    if (r.kind !== 'paused') return
    assert.equal(r.pauseKind, 'client_tool')
    assert.deepStrictEqual(r.pendingToolCallIds, ['cli-1'])

    const restored = await runStore.consume(r.subRunId)
    assert.equal(restored!.pauseKind, 'client_tool')
    assert.deepStrictEqual(restored!.pendingToolCallIds, ['cli-1'])
  })
})
