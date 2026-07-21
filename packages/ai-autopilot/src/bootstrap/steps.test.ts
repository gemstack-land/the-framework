import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent } from '@gemstack/ai-sdk'
import { supervisorBuild, loopChecklist, loopImprove } from './steps.js'
import { agentDeploy, FakeDeployTarget } from './deploy.js'
import { Bootstrap } from './bootstrap.js'
import { LoopEngine } from '../loop/loop.js'
import { definePrompt, defineLoop } from '../loop/define.js'
import { defaultLoops, LOOP_PROMPTS } from '../loop/policy.js'
import type { BootstrapEvent } from './types.js'
import type { SupervisorEvent } from '../types.js'
import type { BuildContext, LoopPassContext } from './types.js'

describe('supervisorBuild (default step over the Supervisor)', () => {
  it('runs the Supervisor and forwards its events as narration', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([{ text: 'wrote the page' }])
      const events: SupervisorEvent[] = []
      const step = supervisorBuild({
        plan: () => [{ description: 'build the catalog page', worker: 'w' }],
        workers: { w: agent({ instructions: 'worker' }) },
        concurrency: 1,
      })
      const ctx: BuildContext = {
        scope: 'full',
        intent: 'a bookstore',
        onEvent: e => events.push(e),
      }
      const run = await step(ctx)

      assert.ok(run.results.length === 1 && run.results[0]?.ok)
      assert.ok(events.some(e => e.type === 'plan'))
      assert.ok(events.some(e => e.type === 'synthesize'))
    } finally {
      fake.restore()
    }
  })

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const step = supervisorBuild({ plan: () => [], workers: agent({ instructions: 'w' }) })
    await assert.rejects(
      async () => step({ scope: 'full', intent: '', onEvent: () => {}, signal: controller.signal }),
      /aborted before start/,
    )
  })
})

describe('loopChecklist / loopImprove (default full-fledged loop steps)', () => {
  const passCtx = (over: Partial<LoopPassContext> = {}): LoopPassContext => ({
    pass: 1,
    intent: 'a bookstore',
    blockers: [],
    ...over,
  })

  it('reads the { blockers } verdict the production-grade prompt returns', async () => {
    const loop = new LoopEngine({
      loops: [defineLoop({ on: 'production-check', run: ['production-grade'] })],
      prompts: [definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": ["no auth"] }\n```' })],
    })
    const verdict = await loopChecklist({ loop })(passCtx())
    assert.deepEqual(verdict.blockers, ['no auth'])
  })

  it('treats a missing verdict as a blocker', async () => {
    const loop = new LoopEngine({
      loops: [defineLoop({ on: 'production-check', run: ['production-grade'] })],
      prompts: [definePrompt({ id: 'production-grade', run: () => 'no verdict here' })],
    })
    const verdict = await loopChecklist({ loop })(passCtx())
    assert.equal(verdict.blockers.length, 1)
    assert.match(verdict.blockers[0]!, /did not return a verdict/)
  })

  it('defaults to an event kind defaultLoops() actually defines (#974)', async () => {
    const loop = new LoopEngine({
      loops: defaultLoops(),
      prompts: [definePrompt({ id: LOOP_PROMPTS.productionGrade, run: () => '```json\n{ "blockers": [] }\n```' })],
    })
    const verdict = await loopChecklist({ loop })(passCtx())
    assert.deepEqual(verdict.blockers, [])
  })

  it('fires the change events so the review chain runs', async () => {
    let reviewRan = 0
    const loop = new LoopEngine({
      loops: [defineLoop({ on: 'major-change', run: ['review'] })],
      prompts: [definePrompt({ id: 'review', run: () => { reviewRan++; return 'reviewed' } })],
    })
    await loopImprove({ loop })(passCtx({ blockers: ['no auth'] }))
    assert.equal(reviewRan, 1)
  })
})

describe('Bootstrap end-to-end with the default steps (offline)', () => {
  it('reaches productionGrade on the documented default path: defaultLoops() + no explicit kind (#974)', async () => {
    const loop = new LoopEngine({
      loops: defaultLoops(),
      prompts: [definePrompt({ id: LOOP_PROMPTS.productionGrade, run: () => '```json\n{ "blockers": [] }\n```' })],
    })
    const boot = new Bootstrap({
      steps: {
        scope: () => ({ scope: 'full', intent: 'a bookstore' }),
        build: () => ({
          text: 'built',
          plan: [],
          results: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          stoppedEarly: false,
        }),
        checklist: loopChecklist({ loop }),
      },
    })

    const result = await boot.run()

    assert.equal(result.productionGrade, true)
    assert.deepEqual(result.blockers, [])
    assert.equal(result.passes, 1) // the gate cleared on the first check, no improve rounds
  })

  it('runs scope → build → full-fledged loop against real primitives', async () => {
    const fake = AiFake.fake()
    try {
      // Two model calls, in order: the build worker, then the deploy decision.
      fake.respondWithSequence([
        { text: 'scaffolded the catalog page and orders schema' },
        { text: JSON.stringify({ render: 'ssr', target: 'dokploy', reason: 'per-request catalog + auth' }) },
      ])

      // The full-fledged loop: first checklist has a blocker, second is clean.
      const verdicts = ['```json\n{ "blockers": ["no auth"] }\n```', '```json\n{ "blockers": [] }\n```']
      let checked = 0
      let improved = 0
      const loop = new LoopEngine({
        loops: [
          defineLoop({ on: 'production-check', run: ['production-grade'] }),
          defineLoop({ on: 'major-change', run: ['fix'] }),
        ],
        prompts: [
          definePrompt({ id: 'production-grade', run: () => verdicts[checked++] ?? '```json\n{ "blockers": [] }\n```' }),
          definePrompt({ id: 'fix', run: () => { improved++; return 'addressed the blockers' } }),
        ],
      })

      const deployTarget = new FakeDeployTarget({ result: { deployed: true, url: 'https://bookstore.example' } })
      const events: BootstrapEvent[] = []
      const boot = new Bootstrap({
        onEvent: e => events.push(e),
        steps: {
          scope: () => ({ scope: 'full', intent: 'a bookstore' }),
          build: supervisorBuild({
            plan: () => [{ description: 'scaffold the app', worker: 'w' }],
            workers: { w: agent({ instructions: 'worker' }) },
            concurrency: 1,
          }),
          checklist: loopChecklist({ loop }),
          improve: loopImprove({ loop }),
          deploy: agentDeploy(agent({ instructions: 'deployer' }), { target: deployTarget }),
        },
      })

      const result = await boot.run()

      assert.equal(result.run.results[0]?.ok, true)
      assert.equal(result.passes, 2)
      assert.deepEqual(result.blockers, [])
      assert.equal(result.productionGrade, true)
      assert.equal(improved, 1) // improved once, between the two checks
      // deploy ran last: decided SSR/dokploy and reached the (fake) target
      assert.deepEqual(result.deploy?.plan, { render: 'ssr', target: 'dokploy', reason: 'per-request catalog + auth' })
      assert.equal(result.deploy?.result.url, 'https://bookstore.example')
      assert.equal(deployTarget.deployed.length, 1)
      // build events were forwarded into the narration
      assert.ok(events.some(e => e.type === 'build' && e.event.type === 'plan'))
      assert.ok(events.some(e => e.type === 'checklist' && e.passing))
      assert.ok(events.some(e => e.type === 'deploy'))
    } finally {
      fake.restore()
    }
  })
})
