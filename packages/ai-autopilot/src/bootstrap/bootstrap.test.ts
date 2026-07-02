import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Bootstrap, createBootstrap, BootstrapAborted } from './bootstrap.js'
import { DecisionLedger } from '../decisions/ledger.js'
import type { BootstrapEvent, BootstrapSteps, ScopeAnswer } from './types.js'
import type { SupervisorRun } from '../types.js'
import type { Verdict } from '../loop/verdict.js'

const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
const fakeRun: SupervisorRun = { text: 'built', plan: [], results: [], usage: zeroUsage, stoppedEarly: false }

/** Build a set of stub steps; override any of them per test. */
function stubSteps(over: Partial<BootstrapSteps> = {}): BootstrapSteps {
  return {
    scope: () => ({ scope: 'full', intent: 'a shop' }) satisfies ScopeAnswer,
    architect: () => ({
      stack: 'Vike + universal-orm',
      narration: 'Server-rendered shop with a Postgres data layer',
      decisions: [{ choice: 'Use Vike for SSR', why: 'SEO + fast first paint' }],
    }),
    build: () => fakeRun,
    checklist: () => ({ blockers: [] }) satisfies Verdict,
    ...over,
  }
}

describe('Bootstrap — happy path (full scope, passes first checklist)', () => {
  it('sequences scope → architect → build → loop and returns a production-grade result', async () => {
    const events: BootstrapEvent[] = []
    const boot = new Bootstrap({ steps: stubSteps(), onEvent: e => events.push(e) })
    const result = await boot.run()

    assert.equal(result.scope, 'full')
    assert.equal(result.intent, 'a shop')
    assert.equal(result.plan.stack, 'Vike + universal-orm')
    assert.equal(result.run, fakeRun)
    assert.equal(result.passes, 1)
    assert.deepEqual(result.blockers, [])
    assert.equal(result.productionGrade, true)
    assert.equal(result.stoppedEarly, false)

    // narration order: scope, architect, its narration, build narration, loop, checklist, done
    const types = events.map(e => e.type)
    assert.deepEqual(types, ['scope', 'architect', 'narrate', 'narrate', 'narrate', 'checklist', 'done'])
    const scoped = events[0]
    assert.ok(scoped?.type === 'scope' && scoped.scope === 'full')
  })

  it('records the architect decisions to the ledger', async () => {
    const ledger = new DecisionLedger()
    const boot = new Bootstrap({ steps: stubSteps(), ledger })
    await boot.run()
    assert.equal(boot.decisions, ledger)
    assert.equal(ledger.size, 1)
    assert.equal(ledger.all()[0]?.status, 'accepted')
    assert.match(ledger.all()[0]!.title, /Vike for SSR/)
  })
})

describe('Bootstrap — full-fledged loop', () => {
  it('improves against blockers and repeats until the checklist is clean', async () => {
    const verdicts: Verdict[] = [{ blockers: ['no auth', 'no tests'] }, { blockers: [] }]
    const improveCalls: readonly string[][] = []
    let call = 0
    const boot = new Bootstrap({
      steps: stubSteps({
        checklist: () => verdicts[call++]!,
        improve: ({ blockers }) => {
          ;(improveCalls as string[][]).push([...blockers])
        },
      }),
    })
    const result = await boot.run()

    assert.equal(result.passes, 2)
    assert.deepEqual(result.blockers, [])
    assert.equal(result.productionGrade, true)
    assert.equal(result.stoppedEarly, false)
    // improve ran once, against pass 1's blockers
    assert.deepEqual(improveCalls, [['no auth', 'no tests']])
  })

  it('stops early at maxPasses with blockers still open', async () => {
    const events: BootstrapEvent[] = []
    let improves = 0
    const boot = new Bootstrap({
      maxPasses: 2,
      steps: stubSteps({
        checklist: () => ({ blockers: ['still no auth'] }),
        improve: () => { improves++ },
      }),
      onEvent: e => events.push(e),
    })
    const result = await boot.run()

    assert.equal(result.passes, 2)
    assert.deepEqual(result.blockers, ['still no auth'])
    assert.equal(result.productionGrade, false)
    assert.equal(result.stoppedEarly, true)
    // improve runs only between passes, so once for 2 passes (no improve after the last)
    assert.equal(improves, 1)
    assert.equal(events.filter(e => e.type === 'checklist').length, 2)
  })
})

describe('Bootstrap — prototype scope', () => {
  it('skips the full-fledged loop entirely', async () => {
    const events: BootstrapEvent[] = []
    let checklistRuns = 0
    const boot = new Bootstrap({
      steps: stubSteps({
        scope: () => ({ scope: 'prototype', intent: 'quick demo' }),
        checklist: () => { checklistRuns++; return { blockers: [] } },
      }),
      onEvent: e => events.push(e),
    })
    const result = await boot.run()

    assert.equal(result.scope, 'prototype')
    assert.equal(result.passes, 0)
    assert.equal(result.productionGrade, false) // not gated, so not claimed
    assert.equal(checklistRuns, 0)
    assert.equal(events.some(e => e.type === 'checklist'), false)
  })
})

describe('Bootstrap — interrupt + isolation', () => {
  it('aborts between phases when the signal fires', async () => {
    const controller = new AbortController()
    const boot = new Bootstrap({
      signal: controller.signal,
      steps: stubSteps({
        architect: () => {
          controller.abort() // user interrupts during the architect phase
          return { stack: 'x', narration: '', decisions: [] }
        },
      }),
    })
    await assert.rejects(() => boot.run(), BootstrapAborted)
  })

  it('does not start when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let scopeRan = false
    const boot = new Bootstrap({
      signal: controller.signal,
      steps: stubSteps({ scope: () => { scopeRan = true; return { scope: 'full', intent: 'x' } } }),
    })
    await assert.rejects(() => boot.run(), BootstrapAborted)
    assert.equal(scopeRan, false)
  })

  it('isolates a throwing onEvent callback', async () => {
    const boot = createBootstrap({
      steps: stubSteps(),
      onEvent: () => { throw new Error('observer bug') },
    })
    // run completes despite the observer throwing on every event
    const result = await boot.run()
    assert.equal(result.productionGrade, true)
  })
})

describe('Bootstrap — construction', () => {
  it('rejects missing steps and a bad maxPasses', () => {
    // @ts-expect-error missing steps
    assert.throws(() => new Bootstrap({}), /requires `steps`/)
    // @ts-expect-error missing build
    assert.throws(() => new Bootstrap({ steps: { scope: () => ({ scope: 'full', intent: '' }), architect: () => ({ stack: '', narration: '', decisions: [] }) } }), /`build` step/)
    assert.throws(() => new Bootstrap({ steps: stubSteps(), maxPasses: 0 }), /maxPasses/)
  })
})
