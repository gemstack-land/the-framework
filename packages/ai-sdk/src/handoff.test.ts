import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Agent } from './agent.js'
import { handoff, isHandoffTool, HANDOFF_MARKER } from './handoff.js'
import { AiRegistry } from './registry.js'
import type {
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  AiMessage,
} from './types.js'

// ─── handoff() factory ────────────────────────────────────

describe('handoff() factory', () => {
  class Sales extends Agent { instructions() { return 'You handle sales.' } }
  class Support extends Agent { instructions() { return 'You handle bugs.' } }

  it('produces a tool tagged with HANDOFF_MARKER', () => {
    const t = handoff(Sales)
    assert.equal((t as unknown as Record<symbol, unknown>)[HANDOFF_MARKER], true)
    assert.equal(isHandoffTool(t), true)
  })

  it('uses default name `handoffTo${AgentClass.name}`', () => {
    const t = handoff(Sales)
    assert.equal(t.definition.name, 'handoffToSales')
  })

  it('honors custom name override', () => {
    const t = handoff(Sales, { name: 'pivotToSales' })
    assert.equal(t.definition.name, 'pivotToSales')
  })

  it('default description names the target agent', () => {
    const t = handoff(Sales)
    assert.equal(t.definition.description, 'Hand off the conversation to Sales.')
  })

  it('appends `when` text to the default description', () => {
    const t = handoff(Sales, { when: 'pricing or sales questions' })
    assert.equal(t.definition.description, 'Hand off the conversation to Sales for pricing or sales questions.')
  })

  it('honors a fully custom description, ignoring `when`', () => {
    const t = handoff(Sales, { when: 'ignored', description: 'Pivot now.' })
    assert.equal(t.definition.description, 'Pivot now.')
  })

  it('default input schema requires `message: string`', () => {
    const t = handoff(Sales)
    const schema = t.definition.inputSchema as z.ZodType
    assert.deepStrictEqual(schema.parse({ message: 'hi' }), { message: 'hi' })
    assert.throws(() => schema.parse({}), /message/i)
  })

  it('honors custom input schemas', () => {
    const t = handoff(Sales, {
      inputSchema: z.object({ urgency: z.enum(['low', 'high']), note: z.string() }),
    })
    const schema = t.definition.inputSchema as z.ZodType
    assert.deepStrictEqual(schema.parse({ urgency: 'high', note: 'asap' }), { urgency: 'high', note: 'asap' })
    assert.throws(() => schema.parse({ urgency: 'medium', note: 'x' }))
  })

  it('handoff tools have no `execute`', () => {
    const t = handoff(Sales)
    assert.equal(t.execute, undefined)
  })

  it('isHandoffTool returns false for null/undefined/objects without the marker', () => {
    assert.equal(isHandoffTool(null), false)
    assert.equal(isHandoffTool(undefined), false)
    assert.equal(isHandoffTool({}), false)
    assert.equal(isHandoffTool({ definition: { name: 'x' } }), false)
  })

  it('multiple handoff() calls produce distinct tools', () => {
    const a = handoff(Sales)
    const b = handoff(Support)
    assert.notStrictEqual(a, b)
    assert.equal(a.definition.name, 'handoffToSales')
    assert.equal(b.definition.name, 'handoffToSupport')
  })
})

// ─── Loop integration: helpers ────────────────────────────

/**
 * Build a deterministic provider adapter that returns one scripted response
 * per `generate()` call (or `stream()` call). Each script entry can either
 * be a final text response or a `tool_calls` step.
 */
type ScriptStep =
  | { kind: 'text';   text: string }
  | { kind: 'toolCalls'; calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }

function scriptedAdapter(
  name: string,
  steps: ScriptStep[],
  capture?: { lastMessages?: AiMessage[][] },
): { factory: { name: string; create: (model: string) => ProviderAdapter }; calls: { count: number; lastOptions: ProviderRequestOptions | undefined } } {
  const calls = { count: 0, lastOptions: undefined as ProviderRequestOptions | undefined }
  const adapter: ProviderAdapter = {
    async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
      const step = steps[calls.count]
      calls.count++
      calls.lastOptions = opts
      if (capture?.lastMessages) capture.lastMessages.push(opts.messages.map((m) => ({ ...m })))
      if (!step) throw new Error(`[${name}] script exhausted at call ${calls.count}`)
      if (step.kind === 'text') {
        return {
          message:      { role: 'assistant', content: step.text },
          usage:        { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'stop',
        }
      }
      return {
        message:      { role: 'assistant', content: '', toolCalls: step.calls },
        usage:        { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'tool_calls',
      }
    },
    async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      const step = steps[calls.count]
      calls.count++
      calls.lastOptions = opts
      if (capture?.lastMessages) capture.lastMessages.push(opts.messages.map((m) => ({ ...m })))
      if (!step) {
        yield { type: 'finish', finishReason: 'stop' }
        return
      }
      if (step.kind === 'text') {
        yield { type: 'text-delta', text: step.text }
        yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } }
        return
      }
      for (const tc of step.calls) {
        yield { type: 'tool-call-delta', toolCall: { id: tc.id, name: tc.name } }
        yield { type: 'tool-call-delta', text: JSON.stringify(tc.arguments) }
      }
      yield {
        type: 'finish',
        finishReason: 'tool_calls',
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      }
    },
  }
  return {
    factory: { name, create: () => adapter },
    calls,
  }
}

// ─── Loop integration: tests ──────────────────────────────

describe('handoff loop integration', () => {
  beforeEach(() => AiRegistry.reset())

  it('parent handoff transfers control; child text becomes the final response', async () => {
    const parentMsgs: AiMessage[][] = []
    const childMsgs: AiMessage[][] = []
    const parent = scriptedAdapter('parent', [
      { kind: 'toolCalls', calls: [{ id: 't1', name: 'handoffToChild', arguments: { message: 'go talk to child' } }] },
    ], { lastMessages: parentMsgs })
    const child = scriptedAdapter('child', [
      { kind: 'text', text: 'child responds' },
    ], { lastMessages: childMsgs })

    AiRegistry.register(parent.factory)
    AiRegistry.register(child.factory)
    AiRegistry.setDefault('parent/m')

    class Child extends Agent {
      instructions() { return 'child instructions' }
      override model() { return 'child/m' }
    }
    class Parent extends Agent {
      instructions() { return 'parent instructions' }
      override model() { return 'parent/m' }
      tools() { return [handoff(Child)] }
    }

    const r = await new Parent().prompt('hello')

    assert.equal(r.text, 'child responds')
    assert.deepEqual(r.handoffPath, ['Parent', 'Child'])
    assert.equal(r.steps.length, 2, 'parent step + child step')
    assert.equal(r.usage.totalTokens, 20, '5+5+5+5 across two model calls')
    assert.equal(parent.calls.count, 1, 'parent model called once')
    assert.equal(child.calls.count, 1, 'child model called once')
  })

  it('child sees the parent\'s carried message history minus the parent system message', async () => {
    const parent = scriptedAdapter('parent', [
      { kind: 'toolCalls', calls: [{ id: 't1', name: 'handoffToChild', arguments: { message: 'go' } }] },
    ])
    const childMsgs: AiMessage[][] = []
    const child = scriptedAdapter('child', [
      { kind: 'text', text: 'ok' },
    ], { lastMessages: childMsgs })

    AiRegistry.register(parent.factory)
    AiRegistry.register(child.factory)
    AiRegistry.setDefault('parent/m')

    class Child extends Agent {
      instructions() { return 'child instructions' }
      override model() { return 'child/m' }
    }
    class Parent extends Agent {
      instructions() { return 'parent instructions' }
      override model() { return 'parent/m' }
      tools() { return [handoff(Child)] }
    }

    await new Parent().prompt('hello user')

    const seen = childMsgs[0]!
    // First message MUST be the child's system message — not the parent's.
    assert.equal(seen[0]?.role, 'system')
    assert.equal(seen[0]?.content, 'child instructions')
    // The parent's system message must NOT appear anywhere.
    assert.equal(seen.some((m) => m.role === 'system' && m.content === 'parent instructions'), false)
    // The user message survives the carry.
    assert.ok(seen.some((m) => m.role === 'user' && (m.content as string).includes('hello user')))
    // The synthesized "Handed off" tool result is in the carried log.
    assert.ok(seen.some((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('Handed off to Child')))
  })

  it('multi-hop: A → B → C populates handoffPath in order and merges all steps', async () => {
    const a = scriptedAdapter('a', [
      { kind: 'toolCalls', calls: [{ id: 'h1', name: 'handoffToB', arguments: { message: 'go to b' } }] },
    ])
    const b = scriptedAdapter('b', [
      { kind: 'toolCalls', calls: [{ id: 'h2', name: 'handoffToC', arguments: { message: 'now go to c' } }] },
    ])
    const c = scriptedAdapter('c', [{ kind: 'text', text: 'final' }])

    AiRegistry.register(a.factory)
    AiRegistry.register(b.factory)
    AiRegistry.register(c.factory)
    AiRegistry.setDefault('a/m')

    class C extends Agent { instructions() { return 'C' } override model() { return 'c/m' } }
    class B extends Agent {
      instructions() { return 'B' }
      override model() { return 'b/m' }
      tools() { return [handoff(C)] }
    }
    class A extends Agent {
      instructions() { return 'A' }
      override model() { return 'a/m' }
      tools() { return [handoff(B)] }
    }

    const r = await new A().prompt('hi')
    assert.equal(r.text, 'final')
    assert.deepEqual(r.handoffPath, ['A', 'B', 'C'])
    assert.equal(r.steps.length, 3, 'one step per hop')
  })

  it('exceeding MAX_HANDOFFS surfaces a clear error instead of looping forever', async () => {
    // A → B → A → B → ...; each agent always hands off back.
    const a = scriptedAdapter('a', Array.from({ length: 10 }, (_, i) =>
      ({ kind: 'toolCalls', calls: [{ id: `aa${i}`, name: 'handoffToBb', arguments: { message: 'b' } }] } as ScriptStep),
    ))
    const b = scriptedAdapter('b', Array.from({ length: 10 }, (_, i) =>
      ({ kind: 'toolCalls', calls: [{ id: `bb${i}`, name: 'handoffToAa', arguments: { message: 'a' } }] } as ScriptStep),
    ))

    AiRegistry.register(a.factory)
    AiRegistry.register(b.factory)
    AiRegistry.setDefault('a/m')

    // Forward-decl: Bb's tools() needs Aa's class, but Aa's tools() needs Bb.
    // Defer the resolution into a holder so the cycle is broken at call time.
    const ref: { Aa?: new () => Agent } = {}
    class Bb extends Agent {
      instructions() { return 'B' }
      override model() { return 'b/m' }
      tools() { return ref.Aa ? [handoff(ref.Aa)] : [] }
    }
    class Aa extends Agent {
      instructions() { return 'A' }
      override model() { return 'a/m' }
      tools() { return [handoff(Bb)] }
    }
    ref.Aa = Aa

    await assert.rejects(() => new Aa().prompt('start'), /max handoffs/i)
  })

  it('streaming pivots from parent stream to child stream and ends with merged response', async () => {
    const parent = scriptedAdapter('parent', [
      { kind: 'toolCalls', calls: [{ id: 't1', name: 'handoffToChild', arguments: { message: 'go' } }] },
    ])
    const child = scriptedAdapter('child', [{ kind: 'text', text: 'child streamed' }])

    AiRegistry.register(parent.factory)
    AiRegistry.register(child.factory)
    AiRegistry.setDefault('parent/m')

    class Child extends Agent {
      instructions() { return 'child' }
      override model() { return 'child/m' }
    }
    class Parent extends Agent {
      instructions() { return 'parent' }
      override model() { return 'parent/m' }
      tools() { return [handoff(Child)] }
    }

    const { stream, response } = new Parent().stream('hi')
    const chunks: StreamChunk[] = []
    for await (const c of stream) chunks.push(c)
    const r = await response

    // We should have seen a `handoff` chunk somewhere in the parent's run.
    const handoffChunk = chunks.find((c) => c.type === 'handoff')
    assert.ok(handoffChunk, 'handoff chunk emitted')
    assert.equal(handoffChunk!.handoff?.from, 'Parent')
    assert.equal(handoffChunk!.handoff?.to, 'Child')
    assert.equal(handoffChunk!.handoff?.message, 'go')

    // Child's text-delta arrives after the handoff.
    const handoffIdx = chunks.indexOf(handoffChunk!)
    const childText = chunks.slice(handoffIdx).find((c) => c.type === 'text-delta')
    assert.ok(childText, 'child text-delta emitted after handoff')
    assert.equal(childText!.text, 'child streamed')

    assert.equal(r.text, 'child streamed')
    assert.deepEqual(r.handoffPath, ['Parent', 'Child'])
  })

  it('a regular tool call alongside a handoff in the same step is skipped with a synthetic result', async () => {
    const parent = scriptedAdapter('parent', [
      {
        kind: 'toolCalls',
        calls: [
          { id: 't1', name: 'handoffToChild', arguments: { message: 'go' } },
          { id: 't2', name: 'sideEffect',     arguments: {} },
        ],
      },
    ])
    const child = scriptedAdapter('child', [{ kind: 'text', text: 'done' }])

    AiRegistry.register(parent.factory)
    AiRegistry.register(child.factory)
    AiRegistry.setDefault('parent/m')

    let sideEffectRan = false
    class Child extends Agent {
      instructions() { return 'c' }
      override model() { return 'child/m' }
    }
    class Parent extends Agent {
      instructions() { return 'p' }
      override model() { return 'parent/m' }
      tools() {
        return [
          handoff(Child),
          {
            definition: { name: 'sideEffect', description: 'side effect', inputSchema: z.object({}) },
            execute: async () => {
              sideEffectRan = true
              return 'should not run'
            },
            toSchema() {
              return { name: 'sideEffect', description: 'side effect', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }
            },
          } as never,
        ]
      }
    }

    const r = await new Parent().prompt('go')
    assert.equal(r.text, 'done')
    assert.equal(sideEffectRan, false, 'sibling tool was skipped, not executed')
  })

  it('handoffPath is absent when no handoff occurred', async () => {
    const adapter = scriptedAdapter('plain', [{ kind: 'text', text: 'hi' }])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('plain/m')

    class Plain extends Agent {
      instructions() { return 'plain' }
      override model() { return 'plain/m' }
    }
    const r = await new Plain().prompt('hi')
    assert.equal(r.handoffPath, undefined)
  })
})
