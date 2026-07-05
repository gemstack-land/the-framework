import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DecisionLedger, LoopEngine, defineLoop, definePrompt, type DeployTarget, type SupervisorEvent } from '@gemstack/ai-autopilot'
import { FakeDriver } from './driver/index.js'
import {
  architectPrompt,
  deployWith,
  domainLoopChecklist,
  driverArchitect,
  driverBuild,
  driverChecklist,
  driverImprove,
  extendPrompt,
  isWorkspaceEmpty,
  MISSING_VERDICT_BLOCKER,
  parseArchitectPlan,
  verdictFromLoopRun,
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

test('domainLoopChecklist dispatches a review event and unions the prompts blockers (#252)', async () => {
  const loop = new LoopEngine({
    loops: [defineLoop({ on: 'major-change', run: ['a', 'b'] })],
    prompts: [
      definePrompt({ id: 'a', run: async () => 'reviewed\n```json\n{"blockers":["fix X"]}\n```' }),
      definePrompt({ id: 'b', run: async () => 'reviewed\n```json\n{"blockers":[]}\n```' }),
    ],
  })
  const verdict = await domainLoopChecklist(loop)({ pass: 1, plan: PLAN, intent: 'build a thing', blockers: [] })
  assert.deepEqual(verdict.blockers, ['fix X']) // union across the chain (b reported none)
})

test('domainLoopChecklist falls back to the built-in checklist when no loop matches the event (#252)', async () => {
  const loop = new LoopEngine({
    loops: [defineLoop({ on: 'bug-fix', run: ['x'] })], // no major-change loop
    prompts: [definePrompt({ id: 'x', run: async () => '' })],
  })
  let fellBack = false
  const checklist = domainLoopChecklist(loop, {
    fallback: async () => {
      fellBack = true
      return { blockers: ['from built-in'] }
    },
  })
  const verdict = await checklist({ pass: 1, plan: PLAN, intent: 'x', blockers: [] })
  assert.equal(fellBack, true)
  assert.deepEqual(verdict.blockers, ['from built-in'])
})

test('verdictFromLoopRun surfaces a review that failed to execute as a blocker', () => {
  const blockers = verdictFromLoopRun({
    event: { kind: 'major-change' },
    matched: true,
    outcomes: [
      { promptId: 'a', passes: [], ok: false, passing: false },
      { promptId: 'b', passes: [], ok: true, passing: true },
    ],
  }).blockers
  assert.deepEqual(blockers, ['review "a" did not complete'])
})

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

test('parseArchitectPlan reads the stack rationale (pros/cons/alternatives)', () => {
  const text =
    '```json\n' +
    JSON.stringify({
      stack: 'Vike',
      narration: 'n',
      decisions: [{ choice: 'SSR', why: 'data' }],
      pros: ['edge deploy', 'renderer-agnostic'],
      cons: ['smaller ecosystem'],
      alternatives: [{ option: 'Next.js', whyNot: 'constrained edge deploy' }],
    }) +
    '\n```'
  const plan = parseArchitectPlan(text, 'an app')
  assert.deepEqual(plan.pros, ['edge deploy', 'renderer-agnostic'])
  assert.deepEqual(plan.cons, ['smaller ecosystem'])
  assert.deepEqual(plan.alternatives, [{ option: 'Next.js', whyNot: 'constrained edge deploy' }])
})

test('parseArchitectPlan omits rationale fields when absent (backward compatible)', () => {
  const plan = parseArchitectPlan('```json\n{"stack":"Vike","narration":"n","decisions":[]}\n```', 'an app')
  assert.equal('pros' in plan, false)
  assert.equal('cons' in plan, false)
  assert.equal('alternatives' in plan, false)
})

test('architectPrompt asks for pros/cons + the rejected alternative, grounded in the tradeoffs', () => {
  const p = architectPrompt('a blog')
  assert.match(p, /PROS and its CONS/)
  assert.match(p, /"alternatives"/)
  assert.match(p, /renderer-agnostic/) // STACK_TRADEOFFS is embedded
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

test('driverChecklist fails closed on a verdict-less reply (not passing)', async () => {
  const session = await new FakeDriver({ turns: [{ text: 'looks fine to me' }] }).start({ cwd: '/ws' })
  const verdict = await driverChecklist(session)({ pass: 1, plan: PLAN, intent: 'x', blockers: [] })
  assert.deepEqual(verdict.blockers, [MISSING_VERDICT_BLOCKER])
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

test('driverBuild extends an existing project instead of rebuilding it (#185)', async () => {
  const cwd = makeWorkspace({ 'package.json': '{}', 'src/index.ts': 'export {}' })
  try {
    const session = await new FakeDriver({ turns: [{ text: 'added the feature' }] }).start({ cwd })
    const events: SupervisorEvent[] = []
    await driverBuild(session, { verifyWorkspace: true })({
      plan: PLAN,
      scope: 'full',
      intent: 'add a search box',
      onEvent: e => events.push(e),
    })
    // Existing codebase: extend framing, and no from-scratch scaffolding language.
    assert.equal(session.prompts.length, 1)
    assert.match(session.prompts[0]!, /existing codebase|do NOT re-scaffold/i)
    assert.doesNotMatch(session.prompts[0]!, /scaffold the whole project|workspace may be empty/i)
    const plan = events.find(e => e.type === 'plan')
    assert.ok(plan?.type === 'plan')
    assert.match(plan.subtasks[0]!.description, /existing codebase/i)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('driverBuild uses greenfield framing for an empty workspace (#185)', async () => {
  const cwd = makeWorkspace() // empty: a from-scratch build
  try {
    const session = await new FakeDriver({ turns: [{ text: 'scaffolded it' }] }).start({ cwd })
    await driverBuild(session, { verifyWorkspace: true })({
      plan: PLAN,
      scope: 'full',
      intent: 'a blog',
      onEvent: () => {},
    })
    assert.match(session.prompts[0]!, /Build this app end to end/i)
    assert.doesNotMatch(session.prompts[0]!, /existing codebase/i)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('extendPrompt names the intent and the detected stack, and forbids a rebuild', () => {
  const prompt = extendPrompt({ stack: 'Next.js', narration: 'n', decisions: [] }, 'add a settings page')
  assert.match(prompt, /add a settings page/)
  assert.match(prompt, /Next\.js/)
  assert.match(prompt, /do NOT re-scaffold|do not.*swap its stack/i)
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
