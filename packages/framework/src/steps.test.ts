import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DecisionLedger, type DeployTarget, type SupervisorEvent } from '@gemstack/ai-autopilot'
import { FakeDriver } from './driver/index.js'
import { deployWith, driverArchitect, driverBuild, driverChecklist, driverImprove, parseArchitectPlan } from './steps.js'

const PLAN = { stack: 'Vike + universal-orm', narration: 'orders app', decisions: [] }

test('parseArchitectPlan reads a fenced json plan', () => {
  const text = 'Here is the plan:\n```json\n{"stack":"Vike","narration":"n","decisions":[{"choice":"SSR","why":"data"}]}\n```'
  const plan = parseArchitectPlan(text, 'an app')
  assert.equal(plan.stack, 'Vike')
  assert.deepEqual(plan.decisions, [{ choice: 'SSR', why: 'data' }])
})

test('parseArchitectPlan falls back safely on garbage', () => {
  const plan = parseArchitectPlan('no json here', 'a blog')
  assert.match(plan.stack, /a blog/)
  assert.deepEqual(plan.decisions, [])
})

test('driverArchitect returns the parsed plan from the driver turn', async () => {
  const session = await new FakeDriver({
    turns: [{ text: '```json\n{"stack":"Next.js","narration":"n","decisions":[]}\n```' }],
  }).start({ cwd: '/ws' })
  const plan = await driverArchitect(session)({ intent: 'x', scope: 'full', ledger: new DecisionLedger() })
  assert.equal(plan.stack, 'Next.js')
})

test('driverBuild emits supervisor events and returns the driver summary', async () => {
  const session = await new FakeDriver({ turns: [{ text: 'Built the app.' }] }).start({ cwd: '/ws' })
  const events: SupervisorEvent[] = []
  const run = await driverBuild(session)({
    plan: PLAN,
    scope: 'full',
    intent: 'orders app',
    onEvent: e => events.push(e),
  })
  assert.equal(run.text, 'Built the app.')
  assert.deepEqual(
    events.map(e => e.type),
    ['plan', 'dispatch-start', 'dispatch-result', 'synthesize'],
  )
})

test('driverChecklist parses the { blockers } verdict', async () => {
  const session = await new FakeDriver({
    turns: [{ text: 'review\n```json\n{"blockers":["no auth"]}\n```' }],
  }).start({ cwd: '/ws' })
  const verdict = await driverChecklist(session)({ pass: 1, plan: PLAN, intent: 'x', blockers: [] })
  assert.deepEqual(verdict.blockers, ['no auth'])
})

test('driverChecklist treats a verdict-less reply as passing', async () => {
  const session = await new FakeDriver({ turns: [{ text: 'looks fine to me' }] }).start({ cwd: '/ws' })
  const verdict = await driverChecklist(session)({ pass: 1, plan: PLAN, intent: 'x', blockers: [] })
  assert.deepEqual(verdict.blockers, [])
})

test('deployWith runs the target against the decided plan and uses its name', async () => {
  const calls: string[] = []
  const target: DeployTarget = {
    name: 'cloudflare',
    deploy: ctx => {
      calls.push(ctx.plan.render)
      return { deployed: true, url: 'https://app.workers.dev', detail: 'shipped' }
    },
  }
  const outcome = await deployWith({ render: 'ssr', reason: 'per-request data' }, target)({
    plan: PLAN,
    scope: 'full',
    intent: 'orders app',
    productionGrade: true,
  })
  assert.equal(outcome.plan.target, 'cloudflare')
  assert.equal(outcome.result.deployed, true)
  assert.equal(outcome.result.url, 'https://app.workers.dev')
  assert.deepEqual(calls, ['ssr'])
})

test('driverImprove prompts the driver with the blockers', async () => {
  const session = await new FakeDriver({ turns: [{ text: 'fixed' }] }).start({ cwd: '/ws' })
  await driverImprove(session)({ pass: 1, plan: PLAN, intent: 'x', blockers: ['add auth'] })
  assert.match(session.prompts[0]!, /add auth/)
})
