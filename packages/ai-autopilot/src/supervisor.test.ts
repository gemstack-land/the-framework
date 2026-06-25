import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Agent } from '@gemstack/ai-sdk'
import type { AgentResponse, TokenUsage } from '@gemstack/ai-sdk'
import { Supervisor } from './supervisor.js'
import type { SupervisorEvent } from './types.js'

const usage = (t: number): TokenUsage => ({ promptTokens: t, completionTokens: 0, totalTokens: t })

/** A worker agent whose `prompt()` is fully scripted — no provider involved. */
class StubAgent extends Agent {
  constructor(private readonly fn: (input: string) => Partial<AgentResponse>) {
    super()
  }
  instructions(): string {
    return 'stub'
  }
  override async prompt(input: string): Promise<AgentResponse> {
    return { text: '', steps: [], usage: usage(0), finishReason: 'stop', ...this.fn(input) }
  }
}

describe('Supervisor — plan → dispatch → synthesize', () => {
  it('runs the happy path with a single worker and the default synthesizer', async () => {
    const echo = new StubAgent((input) => ({ text: `did: ${input}`, usage: usage(10) }))
    const sup = new Supervisor({
      plan: () => [{ description: 'a' }, { description: 'b' }],
      workers: echo,
    })
    const run = await sup.run('task')

    assert.deepEqual(run.plan.map(p => p.id), ['subtask-1', 'subtask-2'])
    assert.ok(run.results.every(r => r.ok))
    assert.equal(run.text, 'did: a\n\ndid: b')
    assert.equal(run.usage.totalTokens, 20)
    assert.equal(run.stoppedEarly, false)
  })

  it('routes subtasks to a named worker pool by subtask.worker', async () => {
    const research = new StubAgent(() => ({ text: 'researched', usage: usage(5) }))
    const writer = new StubAgent(() => ({ text: 'written', usage: usage(5) }))
    const sup = new Supervisor({
      plan: () => [{ description: 'x', worker: 'research' }, { description: 'y', worker: 'write' }],
      workers: { research, write: writer },
    })
    const run = await sup.run('t')
    assert.deepEqual(run.results.map(r => r.text), ['researched', 'written'])
  })

  it('isolates a failing worker — siblings still complete', async () => {
    const ok = new StubAgent(() => ({ text: 'ok', usage: usage(1) }))
    const boom = new StubAgent(() => { throw new Error('worker exploded') })
    const sup = new Supervisor({
      plan: () => [{ description: 'a' }, { description: 'b' }],
      workers: (s) => (s.id === 'subtask-2' ? boom : ok),
    })
    const run = await sup.run('t')
    assert.equal(run.results[0]?.ok, true)
    assert.equal(run.results[1]?.ok, false)
    assert.match(String(run.results[1]?.error), /worker exploded/)
    assert.equal(run.text, 'ok')   // default synth omits the failure
  })

  it('trims a plan over maxSubtasks and flags stoppedEarly', async () => {
    const a = new StubAgent(() => ({ text: 'x', usage: usage(1) }))
    const events: SupervisorEvent[] = []
    const sup = new Supervisor({
      plan: () => [{ description: '1' }, { description: '2' }, { description: '3' }],
      workers: a,
      maxSubtasks: 2,
      onEvent: (e) => events.push(e),
    })
    const run = await sup.run('t')
    assert.equal(run.plan.length, 2)
    assert.equal(run.results.length, 2)
    assert.equal(run.stoppedEarly, true)
    assert.ok(events.some(e => e.type === 'plan-trimmed' && e.dropped === 1))
  })

  it('halts dispatch once the token budget is crossed', async () => {
    const a = new StubAgent(() => ({ text: 'x', usage: usage(100) }))
    const sup = new Supervisor({
      plan: () => [{ description: '1' }, { description: '2' }, { description: '3' }, { description: '4' }],
      workers: a,
      concurrency: 1,                       // deterministic budget accounting
      budget: { maxTotalTokens: 250 },
    })
    const run = await sup.run('t')
    assert.equal(run.results.length, 3)     // 100, 200, 300 — the 4th never starts
    assert.equal(run.usage.totalTokens, 300)
    assert.equal(run.stoppedEarly, true)
  })

  it('reports a paused worker as a failed subtask (no durable resume yet)', async () => {
    const paused = new StubAgent(() => ({
      text: 'partial',
      finishReason: 'tool_approval_required',
      pendingApprovalToolCall: { isClientTool: false, toolCall: {} } as unknown as NonNullable<AgentResponse['pendingApprovalToolCall']>,
      usage: usage(2),
    }))
    const sup = new Supervisor({ plan: () => [{ description: 'a' }], workers: paused })
    const run = await sup.run('t')
    assert.equal(run.results[0]?.ok, false)
    assert.match(String(run.results[0]?.error), /paused/)
  })

  it('isolates an unknown worker key as a failed subtask', async () => {
    const a = new StubAgent(() => ({ text: 'x', usage: usage(1) }))
    const sup = new Supervisor({
      plan: () => [{ description: 'a', worker: 'ghost' }],
      workers: { real: a },
    })
    const run = await sup.run('t')
    assert.equal(run.results[0]?.ok, false)
    assert.match(String(run.results[0]?.error), /no worker named "ghost"/)
  })

  it('emits plan, dispatch, and synthesize events', async () => {
    const a = new StubAgent(() => ({ text: 'x', usage: usage(1) }))
    const types: string[] = []
    const sup = new Supervisor({
      plan: () => [{ description: 'a' }],
      workers: a,
      onEvent: (e) => types.push(e.type),
    })
    await sup.run('t')
    for (const expected of ['plan', 'dispatch-start', 'dispatch-result', 'synthesize']) {
      assert.ok(types.includes(expected), `missing event ${expected}`)
    }
  })
})
