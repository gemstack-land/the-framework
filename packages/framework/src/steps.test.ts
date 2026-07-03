import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DecisionLedger, type DeployTarget, type SupervisorEvent } from '@gemstack/ai-autopilot'
import { FakeDriver } from './driver/index.js'
import {
  deployWith,
  driverArchitect,
  driverBuild,
  driverChecklist,
  driverImprove,
  isWorkspaceEmpty,
  parseArchitectPlan,
} from './steps.js'

/** Make a throwaway workspace dir, seeded with the given relative files. */
function makeWorkspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'fw-steps-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

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

test('isWorkspaceEmpty: true for an empty dir and one with only noise, false with a source file', () => {
  const empty = makeWorkspace()
  const noise = makeWorkspace({
    'package-lock.json': '{}',
    '.gitignore': 'node_modules',
    'node_modules/dep/index.js': 'x',
  })
  const built = makeWorkspace({ 'src/index.ts': 'export {}' })
  try {
    assert.equal(isWorkspaceEmpty(empty), true)
    assert.equal(isWorkspaceEmpty(noise), true)
    assert.equal(isWorkspaceEmpty(built), false)
    assert.equal(isWorkspaceEmpty(join(empty, 'does-not-exist')), true)
  } finally {
    for (const d of [empty, noise, built]) rmSync(d, { recursive: true, force: true })
  }
})

test('driverBuild re-prompts to scaffold from scratch when the workspace stays empty (#182)', async () => {
  const cwd = makeWorkspace() // empty: the agent produced nothing
  try {
    const session = await new FakeDriver({
      turns: [{ text: 'thinking about the stack' }, { text: 'scaffolded the whole app' }],
    }).start({ cwd })
    const events: SupervisorEvent[] = []
    const run = await driverBuild(session, { verifyWorkspace: true })({
      plan: PLAN,
      scope: 'full',
      intent: 'a blog',
      onEvent: e => events.push(e),
    })
    // Two dispatches: the build, then the hard from-scratch retry.
    assert.equal(session.prompts.length, 2)
    assert.match(session.prompts[1]!, /from scratch|empty/i)
    assert.equal(run.plan.length, 2)
    assert.deepEqual(
      events.map(e => e.type),
      ['plan', 'dispatch-start', 'dispatch-result', 'dispatch-start', 'dispatch-result', 'synthesize'],
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('driverBuild does not re-prompt when the build produced files', async () => {
  const cwd = makeWorkspace({ 'package.json': '{}', 'pages/index.tsx': 'export default () => null' })
  try {
    const session = await new FakeDriver({ turns: [{ text: 'built it' }] }).start({ cwd })
    const run = await driverBuild(session, { verifyWorkspace: true })({
      plan: PLAN,
      scope: 'full',
      intent: 'a blog',
      onEvent: () => {},
    })
    assert.equal(session.prompts.length, 1)
    assert.equal(run.plan.length, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('driverImprove scaffolds from scratch when the workspace is empty, else fixes blockers (#182)', async () => {
  const emptyCwd = makeWorkspace()
  const builtCwd = makeWorkspace({ 'src/app.ts': 'export {}' })
  try {
    const s1 = await new FakeDriver({ turns: [{ text: 'scaffolded' }] }).start({ cwd: emptyCwd })
    await driverImprove(s1, { verifyWorkspace: true })({ pass: 1, plan: PLAN, intent: 'a blog', blockers: ['add auth'] })
    // Empty workspace: it scaffolds instead of making the "smallest change".
    assert.match(s1.prompts[0]!, /from scratch|empty/i)
    assert.doesNotMatch(s1.prompts[0]!, /add auth/)

    const s2 = await new FakeDriver({ turns: [{ text: 'fixed' }] }).start({ cwd: builtCwd })
    await driverImprove(s2, { verifyWorkspace: true })({ pass: 1, plan: PLAN, intent: 'a blog', blockers: ['add auth'] })
    assert.match(s2.prompts[0]!, /add auth/)
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true })
    rmSync(builtCwd, { recursive: true, force: true })
  }
})
