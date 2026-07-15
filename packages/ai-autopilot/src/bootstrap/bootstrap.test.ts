import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Bootstrap, createBootstrap, BootstrapAborted } from './bootstrap.js'
import type { BootstrapEvent, BootstrapSteps, ScopeAnswer } from './types.js'
import type { SupervisorRun } from '../types.js'
import type { Verdict } from '../loop/verdict.js'

const zeroUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
const fakeRun: SupervisorRun = { text: 'built', plan: [], results: [], usage: zeroUsage, stoppedEarly: false }

/** Build a set of stub steps; override any of them per test. */
function stubSteps(over: Partial<BootstrapSteps> = {}): BootstrapSteps {
  return {
    scope: () => ({ scope: 'full', intent: 'a shop' }) satisfies ScopeAnswer,
    build: () => fakeRun,
    checklist: () => ({ blockers: [] }) satisfies Verdict,
    ...over,
  }
}

describe('Bootstrap — happy path (full scope, passes first checklist)', () => {
  it('sequences scope → build → loop and returns a production-grade result', async () => {
    const events: BootstrapEvent[] = []
    const boot = new Bootstrap({ steps: stubSteps(), onEvent: e => events.push(e) })
    const result = await boot.run()

    assert.equal(result.scope, 'full')
    assert.equal(result.intent, 'a shop')
    assert.equal(result.run, fakeRun)
    assert.equal(result.passes, 1)
    assert.deepEqual(result.blockers, [])
    assert.equal(result.productionGrade, true)
    assert.equal(result.stoppedEarly, false)

    // narration order: scope, loop narration, checklist, done
    const types = events.map(e => e.type)
    assert.deepEqual(types, ['scope', 'narrate', 'checklist', 'done'])
    const scoped = events[0]
    assert.ok(scoped?.type === 'scope' && scoped.scope === 'full')
  })

  it('hands the scope and intent to the build step', async () => {
    let seen: { scope: string; intent: string } | undefined
    const boot = new Bootstrap({
      steps: stubSteps({
        build: ({ scope, intent }) => {
          seen = { scope, intent }
          return fakeRun
        },
      }),
    })
    await boot.run()
    assert.deepEqual(seen, { scope: 'full', intent: 'a shop' })
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

describe('Bootstrap — deploy phase', () => {
  const deployStub = (): NonNullable<BootstrapSteps['deploy']> => () => ({
    plan: { render: 'ssr', target: 'dokploy', reason: 'per-request data' },
    result: { deployed: false, detail: 'plan only' },
  })

  it('runs the deploy step last and carries its outcome on the result', async () => {
    const events: BootstrapEvent[] = []
    const boot = new Bootstrap({ steps: stubSteps({ deploy: deployStub() }), onEvent: e => events.push(e) })
    const result = await boot.run()

    assert.equal(result.deploy?.plan.render, 'ssr')
    assert.equal(result.deploy?.plan.target, 'dokploy')
    assert.equal(result.deploy?.result.deployed, false)
    // deploy narration + event land after the checklist, before done
    const types = events.map(e => e.type)
    assert.deepEqual(types.slice(-3), ['narrate', 'deploy', 'done'])
    const deployEvent = events.find(e => e.type === 'deploy')
    assert.equal(deployEvent?.type === 'deploy' && deployEvent.plan.target, 'dokploy')
  })

  it('is optional — no deploy step means no deploy on the result', async () => {
    const boot = new Bootstrap({ steps: stubSteps() })
    const result = await boot.run()
    assert.equal(result.deploy, undefined)
  })

  it('passes productionGrade into the deploy context', async () => {
    let seenProductionGrade: boolean | undefined
    const boot = new Bootstrap({
      steps: stubSteps({
        deploy: ctx => {
          seenProductionGrade = ctx.productionGrade
          return { plan: { render: 'ssg', target: 'cloudflare', reason: 'static' }, result: { deployed: false } }
        },
      }),
    })
    await boot.run()
    assert.equal(seenProductionGrade, true) // full scope, passed the checklist
  })

  it('runs deploy for a prototype too (not loop-gated)', async () => {
    let deployRan = false
    const boot = new Bootstrap({
      steps: stubSteps({
        scope: () => ({ scope: 'prototype', intent: 'quick demo' }),
        deploy: ctx => {
          deployRan = true
          assert.equal(ctx.productionGrade, false) // prototype never runs the loop
          return { plan: { render: 'spa', target: 'cloudflare', reason: 'client demo' }, result: { deployed: false } }
        },
      }),
    })
    const result = await boot.run()
    assert.equal(deployRan, true)
    assert.equal(result.deploy?.plan.render, 'spa')
  })
})

describe('Bootstrap — interrupt + isolation', () => {
  it('aborts between phases when the signal fires', async () => {
    const controller = new AbortController()
    const boot = new Bootstrap({
      signal: controller.signal,
      steps: stubSteps({
        build: () => {
          controller.abort() // user interrupts during the build phase
          return fakeRun
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
    assert.throws(() => new Bootstrap({ steps: { scope: () => ({ scope: 'full', intent: '' }) } }), /`build` step/)
    assert.throws(() => new Bootstrap({ steps: stubSteps(), maxPasses: 0 }), /maxPasses/)
  })
})
