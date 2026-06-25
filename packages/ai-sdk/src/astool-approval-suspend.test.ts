import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent, agent } from './agent.js'
import { AiFake } from './fake.js'
import { toolDefinition } from './tool.js'
import {
  InMemorySubAgentRunStore,
  type SubAgentRunSnapshot,
  type SubAgentRunStore,
} from './sub-agent-run-store.js'
import { z } from 'zod'
import type { SubAgentUpdate } from './types.js'

// ─── Test fixtures ────────────────────────────────────────

const dangerousTool = toolDefinition({
  name:          'delete_record',
  description:   'Delete a record (gated).',
  inputSchema:   z.object({ id: z.string() }),
  needsApproval: true,
}).server(async () => 'deleted')

class GuardedAgent extends Agent {
  instructions() { return 'You delete things, with approval.' }
  tools() { return [dangerousTool] }
}

// ─── 1. Suspend on approval-gated server tool ────────────

describe('asTool() — suspend on approval-gated server tool', () => {
  let fake: AiFake

  beforeEach(() => { fake = AiFake.fake() })

  it('parent halts with finishReason=tool_approval_required and persists snapshot with pauseKind=approval', async () => {
    const runStore = new InMemorySubAgentRunStore()

    let storedSubRunId:  string                 | undefined
    let storedSnapshot:  SubAgentRunSnapshot    | undefined
    const spy: SubAgentRunStore = {
      async store(id, snap) { storedSubRunId = id; storedSnapshot = snap; await runStore.store(id, snap) },
      async consume(id)     { return runStore.consume(id) },
    }

    const sub = new GuardedAgent().asTool({
      name:        'guarded',
      description: 'Sub-agent that may invoke a destructive gated tool.',
      streaming:   true,
      suspendable: { runStore: spy },
    })
    const parent = agent({ instructions: 'Parent.', tools: [sub] })

    fake.respondWithSequence([
      // parent step 0 — call the sub
      { toolCalls: [{ id: 'p1', name: 'guarded', arguments: { prompt: 'delete user 7' } }] },
      // sub step 0 — model invokes the gated tool; loop halts before execute
      { toolCalls: [{ id: 'inner-1', name: 'delete_record', arguments: { id: '7' } }] },
    ])

    const { stream, response } = parent.stream('go')
    const updates: SubAgentUpdate[] = []
    for await (const chunk of stream) {
      if (chunk.type === 'tool-update' && chunk.update) {
        updates.push(chunk.update as SubAgentUpdate)
      }
    }
    const r = await response

    // Parent loop halted on the inner approval gate.
    assert.equal(r.finishReason, 'tool_approval_required', `parent should halt on approval; got ${r.finishReason}`)
    assert.equal(r.pendingApprovalToolCall?.toolCall.id, 'inner-1')
    assert.equal(r.pendingApprovalToolCall?.isClientTool, false)

    // Snapshot persisted with the approval discriminator.
    assert.ok(storedSubRunId, 'runStore.store should have been called')
    assert.ok(storedSnapshot, 'snapshot should be defined')
    assert.equal(storedSnapshot!.pauseKind, 'approval')
    assert.deepStrictEqual(storedSnapshot!.pendingToolCallIds, ['inner-1'])
    assert.equal(storedSnapshot!.pendingApprovalToolCall?.toolCall.id, 'inner-1')
    assert.equal(storedSnapshot!.pendingApprovalToolCall?.isClientTool, false)
    assert.ok(storedSnapshot!.messages.length >= 2, 'snapshot carries the user prompt + assistant turn')
    assert.equal(storedSnapshot!.messages[0]!.role, 'user')

    // Streaming projection emitted both updates: agent_pending_approval
    // (informational, from the inner pending-approval chunk) and
    // subagent_paused_approval (suspend boundary, carrying subRunId).
    const pending = updates.find(u => u.kind === 'agent_pending_approval') as
      | Extract<SubAgentUpdate, { kind: 'agent_pending_approval' }>
      | undefined
    assert.ok(pending, 'agent_pending_approval update emitted')
    assert.equal(pending!.toolCall.id, 'inner-1')
    assert.equal(pending!.isClientTool, false)

    const paused = updates.find(u => u.kind === 'subagent_paused_approval') as
      | Extract<SubAgentUpdate, { kind: 'subagent_paused_approval' }>
      | undefined
    assert.ok(paused, 'subagent_paused_approval update emitted at suspend boundary')
    assert.equal(paused!.subRunId, storedSubRunId)
    assert.equal(paused!.toolCall.id, 'inner-1')
  })

  it('snapshot round-trips through the runStore', async () => {
    const runStore = new InMemorySubAgentRunStore()
    const sub = new GuardedAgent().asTool({
      name:        'guarded',
      description: 'Gated.',
      streaming:   true,
      suspendable: { runStore },
    })
    const parent = agent({ instructions: 'Parent.', tools: [sub] })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'p1', name: 'guarded', arguments: { prompt: 'delete user 99' } }] },
      { toolCalls: [{ id: 'inner-2', name: 'delete_record', arguments: { id: '99' } }] },
    ])

    const { stream, response } = parent.stream('go')
    let subRunId: string | undefined
    for await (const chunk of stream) {
      if (chunk.type === 'tool-update' && chunk.update) {
        const u = chunk.update as SubAgentUpdate
        if (u.kind === 'subagent_paused_approval') subRunId = u.subRunId
      }
    }
    await response

    assert.ok(subRunId, 'subagent_paused_approval should provide a subRunId')
    const restored = await runStore.consume(subRunId!)
    assert.ok(restored, 'snapshot must be retrievable from the store')
    assert.equal(restored!.pauseKind, 'approval')
    assert.deepStrictEqual(restored!.pendingToolCallIds, ['inner-2'])
    assert.equal(restored!.pendingApprovalToolCall?.toolCall.id, 'inner-2')
  })
})
