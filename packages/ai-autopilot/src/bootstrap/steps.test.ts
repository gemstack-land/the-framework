import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiFake, agent } from '@gemstack/ai-sdk'
import { agentArchitect, supervisorBuild, loopChecklist, loopImprove } from './steps.js'
import { agentDeploy, FakeDeployTarget } from './deploy.js'
import { Bootstrap } from './bootstrap.js'
import { DecisionLedger } from '../decisions/ledger.js'
import { Loop } from '../loop/loop.js'
import { definePrompt, defineRule } from '../loop/define.js'
import type { BootstrapEvent } from './types.js'
import type { SupervisorEvent } from '../types.js'
import type { ArchitectContext, BuildContext, LoopPassContext } from './types.js'

const architectCtx = (over: Partial<ArchitectContext> = {}): ArchitectContext => ({
  intent: 'a bookstore',
  scope: 'full',
  ledger: new DecisionLedger(),
  ...over,
})

describe('agentArchitect (default step over an ai-sdk agent)', () => {
  it('parses a structured plan and prepends the decisions briefing', async () => {
    const fake = AiFake.fake()
    try {
      fake.respondWithSequence([
        {
          text: JSON.stringify({
            stack: 'Vike + universal-orm',
            narration: 'A server-rendered bookstore',
            decisions: [{ choice: 'Postgres', why: 'relational catalog' }],
          }),
        },
      ])
      const ledger = new DecisionLedger()
      ledger.reject('Use a NoSQL document store', 'the catalog is relational')

      const step = agentArchitect(agent({ instructions: 'architect' }))
      const plan = await step(architectCtx({ ledger }))

      assert.equal(plan.stack, 'Vike + universal-orm')
      assert.equal(plan.decisions[0]?.choice, 'Postgres')
      // the rejected idea reached the model as a briefing so it will not re-pitch it
      const sent = JSON.stringify(fake.getCalls()[0])
      assert.match(sent, /NoSQL document store/)
    } finally {
      fake.restore()
    }
  })
})

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
        plan: { stack: 'Vike + universal-orm', narration: '', decisions: [] },
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
      async () => step({ plan: { stack: '', narration: '', decisions: [] }, scope: 'full', intent: '', onEvent: () => {}, signal: controller.signal }),
      /aborted before start/,
    )
  })
})

describe('loopChecklist / loopImprove (default full-fledged loop steps)', () => {
  const passCtx = (over: Partial<LoopPassContext> = {}): LoopPassContext => ({
    pass: 1,
    plan: { stack: 'Vike + universal-orm', narration: '', decisions: [] },
    intent: 'a bookstore',
    blockers: [],
    ...over,
  })

  it('reads the { blockers } verdict the production-grade prompt returns', async () => {
    const loop = new Loop({
      rules: [defineRule({ on: 'production-check', run: ['production-grade'] })],
      prompts: [definePrompt({ id: 'production-grade', run: () => '```json\n{ "blockers": ["no auth"] }\n```' })],
    })
    const verdict = await loopChecklist({ loop })(passCtx())
    assert.deepEqual(verdict.blockers, ['no auth'])
  })

  it('treats a missing verdict as a blocker', async () => {
    const loop = new Loop({
      rules: [defineRule({ on: 'production-check', run: ['production-grade'] })],
      prompts: [definePrompt({ id: 'production-grade', run: () => 'no verdict here' })],
    })
    const verdict = await loopChecklist({ loop })(passCtx())
    assert.equal(verdict.blockers.length, 1)
    assert.match(verdict.blockers[0]!, /did not return a verdict/)
  })

  it('fires the change events so the review chain runs', async () => {
    let reviewRan = 0
    const loop = new Loop({
      rules: [defineRule({ on: 'major-change', run: ['review'] })],
      prompts: [definePrompt({ id: 'review', run: () => { reviewRan++; return 'reviewed' } })],
    })
    await loopImprove({ loop })(passCtx({ blockers: ['no auth'] }))
    assert.equal(reviewRan, 1)
  })
})

describe('Bootstrap end-to-end with the default steps (offline)', () => {
  it('runs scope → architect → build → full-fledged loop against real primitives', async () => {
    const fake = AiFake.fake()
    try {
      // Three model calls, in order: the architect plan, the build worker, the deploy decision.
      fake.respondWithSequence([
        {
          text: JSON.stringify({
            stack: 'Vike + universal-orm',
            narration: 'A server-rendered bookstore with a Postgres data layer',
            decisions: [{ choice: 'universal-orm on Postgres', why: 'typed, relational catalog' }],
          }),
        },
        { text: 'scaffolded the catalog page and orders schema' },
        { text: JSON.stringify({ render: 'ssr', target: 'dockploy', reason: 'per-request catalog + auth' }) },
      ])

      // The full-fledged loop: first checklist has a blocker, second is clean.
      const verdicts = ['```json\n{ "blockers": ["no auth"] }\n```', '```json\n{ "blockers": [] }\n```']
      let checked = 0
      let improved = 0
      const loop = new Loop({
        rules: [
          defineRule({ on: 'production-check', run: ['production-grade'] }),
          defineRule({ on: 'major-change', run: ['fix'] }),
        ],
        prompts: [
          definePrompt({ id: 'production-grade', run: () => verdicts[checked++] ?? '```json\n{ "blockers": [] }\n```' }),
          definePrompt({ id: 'fix', run: () => { improved++; return 'addressed the blockers' } }),
        ],
      })

      const ledger = new DecisionLedger()
      const deployTarget = new FakeDeployTarget({ result: { deployed: true, url: 'https://bookstore.example' } })
      const events: BootstrapEvent[] = []
      const boot = new Bootstrap({
        ledger,
        onEvent: e => events.push(e),
        steps: {
          scope: () => ({ scope: 'full', intent: 'a bookstore' }),
          architect: agentArchitect(agent({ instructions: 'architect' })),
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

      assert.equal(result.plan.stack, 'Vike + universal-orm')
      assert.equal(result.run.results[0]?.ok, true)
      assert.equal(result.passes, 2)
      assert.deepEqual(result.blockers, [])
      assert.equal(result.productionGrade, true)
      assert.equal(improved, 1) // improved once, between the two checks
      assert.equal(ledger.size, 1) // architect choice recorded
      // deploy ran last: decided SSR/dockploy and reached the (fake) target
      assert.deepEqual(result.deploy?.plan, { render: 'ssr', target: 'dockploy', reason: 'per-request catalog + auth' })
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
