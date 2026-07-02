import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Loop, createLoop } from './loop.js'
import { definePrompt, defineRule } from './define.js'
import { defaultLoopRules } from './policy.js'
import { DecisionLedger } from '../decisions/ledger.js'
import type { LoopContext, LoopProgress } from './types.js'

/** A prompt that records the contexts it was called with. */
function spyPrompt(id: string, passes?: number) {
  const calls: LoopContext[] = []
  const prompt = definePrompt({
    id,
    ...(passes ? { passes } : {}),
    run: ctx => {
      calls.push(ctx)
      return `${id}#${ctx.pass}`
    },
  })
  return { prompt, calls }
}

describe('Loop — matching', () => {
  const loop = new Loop({ rules: defaultLoopRules(), prompts: [] })

  it('resolves the chain for a kind, in order and de-duped across rules', () => {
    assert.deepEqual(loop.matches({ kind: 'major-change' }), ['review', 'code-quality', 'security'])
    assert.deepEqual(loop.matches({ kind: 'ui-flow' }), ['qa', 'ux'])
    assert.deepEqual(loop.matches({ kind: 'nothing' }), [])
  })

  it('concatenates and de-dupes when two rules match the same kind', () => {
    const l = new Loop({
      rules: [defineRule({ on: 'x', run: ['a', 'b'] }), defineRule({ on: 'x', run: ['b', 'c'] })],
      prompts: [],
    })
    assert.deepEqual(l.matches({ kind: 'x' }), ['a', 'b', 'c'])
  })
})

describe('Loop — dispatch', () => {
  it('runs the matched chain in order and reports outcomes', async () => {
    const review = spyPrompt('review')
    const security = spyPrompt('security')
    const order: string[] = []
    const loop = new Loop({
      rules: [defineRule({ on: 'major-change', run: ['review', 'security'] })],
      prompts: [
        definePrompt({ id: 'review', run: () => { order.push('review'); return 'r' } }),
        definePrompt({ id: 'security', run: () => { order.push('security'); return 's' } }),
      ],
    })
    const result = await loop.handle({ kind: 'major-change', summary: 'x' })
    assert.equal(result.matched, true)
    assert.deepEqual(order, ['review', 'security'])
    assert.deepEqual(result.outcomes.map(o => o.promptId), ['review', 'security'])
    assert.ok(result.outcomes.every(o => o.ok))
    void review; void security
  })

  it('reports matched:false and runs nothing when no rule fires', async () => {
    const events: LoopProgress[] = []
    const loop = createLoop({ rules: defaultLoopRules(), prompts: [], onEvent: e => events.push(e) })
    const result = await loop.handle({ kind: 'unrelated' })
    assert.equal(result.matched, false)
    assert.deepEqual(result.outcomes, [])
    assert.equal(events[0]?.type, 'no-match')
  })

  it('runs N fresh-context passes, each with an incrementing pass number', async () => {
    const { prompt, calls } = spyPrompt('review', 3)
    const loop = new Loop({ rules: [defineRule({ on: 'c', run: ['review'] })], prompts: [prompt] })
    const result = await loop.handle({ kind: 'c' })
    assert.deepEqual(calls.map(c => c.pass), [1, 2, 3])
    assert.ok(calls.every(c => c.passes === 3))
    assert.deepEqual(result.outcomes[0]?.passes.map(p => p.text), ['review#1', 'review#2', 'review#3'])
  })

  it('flags a rule that references an unknown prompt without throwing', async () => {
    const events: LoopProgress[] = []
    const loop = new Loop({
      rules: [defineRule({ on: 'c', run: ['ghost'] })],
      prompts: [],
      onEvent: e => events.push(e),
    })
    const result = await loop.handle({ kind: 'c' })
    assert.equal(result.outcomes[0]?.ok, false)
    assert.ok(events.some(e => e.type === 'unknown-prompt' && e.promptId === 'ghost'))
  })
})

describe('Loop — failure policy', () => {
  const failing = definePrompt({ id: 'review', run: () => { throw new Error('boom') } })
  const after = definePrompt({ id: 'security', run: () => 'ran' })
  const rules = [defineRule({ on: 'major-change', run: ['review', 'security'] })]

  it('continues past a failure by default (fire-and-report)', async () => {
    const loop = new Loop({ rules, prompts: [failing, after] })
    const result = await loop.handle({ kind: 'major-change' })
    assert.equal(result.outcomes[0]?.ok, false)
    assert.equal(result.outcomes[1]?.ok, true) // security still ran
    assert.match(String((result.outcomes[0]?.passes[0]?.error as Error).message), /boom/)
  })

  it('stops the chain on failure when continueOnError is false (gate)', async () => {
    const events: LoopProgress[] = []
    const loop = new Loop({ rules, prompts: [failing, after], continueOnError: false, onEvent: e => events.push(e) })
    const result = await loop.handle({ kind: 'major-change' })
    assert.equal(result.outcomes.length, 1) // security was gated out
    assert.ok(events.some(e => e.type === 'gate-stop' && e.promptId === 'review'))
  })
})

describe('Loop — verdict gating', () => {
  const rules = [defineRule({ on: 'check', run: ['production-grade', 'after'] })]
  const after = definePrompt({ id: 'after', run: () => 'ran' })

  it('parses a verdict onto the outcome and marks blockers not-passing', async () => {
    const gate = definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": ["no auth"] }\n```' })
    const loop = new Loop({ rules, prompts: [gate, after] })
    const result = await loop.handle({ kind: 'check' })
    const outcome = result.outcomes[0]!
    assert.equal(outcome.ok, true) // it executed
    assert.equal(outcome.passing, false) // but it reported blockers
    assert.deepEqual(outcome.verdict?.blockers, ['no auth'])
  })

  it('an empty blockers verdict is passing', async () => {
    const gate = definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": [] }\n```' })
    const loop = new Loop({ rules, prompts: [gate, after] })
    const result = await loop.handle({ kind: 'check' })
    assert.equal(result.outcomes[0]?.passing, true)
  })

  it('gates the chain on blockers when continueOnError is false', async () => {
    const events: LoopProgress[] = []
    const gate = definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": ["no tests"] }\n```' })
    const loop = new Loop({ rules, prompts: [gate, after], continueOnError: false, onEvent: e => events.push(e) })
    const result = await loop.handle({ kind: 'check' })
    assert.equal(result.outcomes.length, 1) // `after` was gated out on the verdict, not an error
    assert.ok(events.some(e => e.type === 'gate-stop' && e.promptId === 'production-grade'))
  })

  it('a prompt with no verdict still passes when it executes (backward compatible)', async () => {
    const gate = definePrompt({ id: 'production-grade', run: () => 'no json here' })
    const loop = new Loop({ rules, prompts: [gate, after] })
    const result = await loop.handle({ kind: 'check' })
    assert.equal(result.outcomes[0]?.passing, true)
    assert.equal(result.outcomes[0]?.verdict, undefined)
  })

  it('verdict: null disables parsing (execution-only gate)', async () => {
    const gate = definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": ["x"] }\n```' })
    const loop = new Loop({ rules, prompts: [gate, after], verdict: null })
    const result = await loop.handle({ kind: 'check' })
    assert.equal(result.outcomes[0]?.passing, true) // blockers ignored
    assert.equal(result.outcomes[0]?.verdict, undefined)
  })
})

describe('Loop — decisions + watch', () => {
  it('exposes the ledger to prompts via context', async () => {
    const ledger = new DecisionLedger()
    ledger.reject('Use Redux', 'boilerplate')
    let seen: DecisionLedger | undefined
    const loop = new Loop({
      rules: [defineRule({ on: 'c', run: ['review'] })],
      prompts: [definePrompt({ id: 'review', run: ctx => { seen = ctx.ledger; return '' } })],
      ledger,
    })
    await loop.handle({ kind: 'c' })
    assert.equal(seen?.wasRejected('add redux'), true)
  })

  it('watch() handles a stream of events in order', async () => {
    const loop = new Loop({
      rules: [defineRule({ on: 'c', run: ['review'] })],
      prompts: [definePrompt({ id: 'review', run: ctx => ctx.event.summary ?? '' })],
    })
    const results = await loop.watch([
      { kind: 'c', summary: 'first' },
      { kind: 'nope' },
      { kind: 'c', summary: 'second' },
    ])
    assert.deepEqual(results.map(r => r.matched), [true, false, true])
    assert.equal(results[0]?.outcomes[0]?.passes[0]?.text, 'first')
  })

  it('isolates a throwing onEvent callback', async () => {
    const loop = new Loop({
      rules: [defineRule({ on: 'c', run: ['review'] })],
      prompts: [definePrompt({ id: 'review', run: () => 'ok' })],
      onEvent: () => { throw new Error('observer bug') },
    })
    const result = await loop.handle({ kind: 'c' })
    assert.equal(result.outcomes[0]?.ok, true) // run completed despite the observer throwing
  })
})
