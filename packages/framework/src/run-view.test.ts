import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { architectPlan, decisionLedger, loopStatus, sessionInfo, deployPlan } from './run-view.js'
import type { FrameworkEvent } from './events.js'

const architect = (stack: string, extra: Record<string, unknown> = {}): FrameworkEvent => ({
  kind: 'bootstrap',
  event: { type: 'architect', stack, decisions: [], ...extra } as never,
})

test('architectPlan returns the chosen stack + rationale from the architect event (#431)', () => {
  const events: FrameworkEvent[] = [
    { kind: 'log', message: 'hi' },
    architect('Vike + Prisma', {
      decisions: [{ choice: 'Prisma on Postgres', why: 'relational catalog' }],
      pros: ['edge deploy'],
      cons: ['smaller ecosystem'],
      alternatives: [{ option: 'Next.js', whyNot: 'constrained edge deploy' }],
    }),
  ]
  const plan = architectPlan(events)
  assert.equal(plan?.stack, 'Vike + Prisma')
  assert.deepEqual(plan?.pros, ['edge deploy'])
  assert.deepEqual(plan?.cons, ['smaller ecosystem'])
  assert.deepEqual(plan?.decisions, [{ choice: 'Prisma on Postgres', why: 'relational catalog' }])
  assert.deepEqual(plan?.alternatives, [{ option: 'Next.js', whyNot: 'constrained edge deploy' }])
})

test('architectPlan is null before the architect runs; latest wins on re-architect', () => {
  assert.equal(architectPlan([{ kind: 'log', message: 'x' }]), null)
  const plan = architectPlan([architect('Vike'), architect('Next.js')])
  assert.equal(plan?.stack, 'Next.js') // #324 re-architect supersedes
})

test('decisionLedger accumulates decisions then lists rejected alternatives (#431)', () => {
  const events: FrameworkEvent[] = [
    architect('Vike', { decisions: [{ choice: 'Vike for SSR', why: 'SEO' }] }),
    architect('Vike + auth', {
      decisions: [{ choice: 'vike-auth', why: 'sessions' }],
      alternatives: [{ option: 'Next.js', whyNot: 'edge deploy' }],
    }),
  ]
  const ledger = decisionLedger(events)
  assert.deepEqual(ledger, [
    { choice: 'Vike for SSR', why: 'SEO', rejected: false },
    { choice: 'vike-auth', why: 'sessions', rejected: false },
    { choice: 'Next.js', why: 'edge deploy', rejected: true },
  ])
})

test('loopStatus tracks the latest checklist verdict and closes on done (#431)', () => {
  const boot = (event: Record<string, unknown>): FrameworkEvent => ({ kind: 'bootstrap', event: event as never })
  assert.equal(loopStatus([{ kind: 'log', message: 'x' }]), null) // no checklist yet

  const failing = loopStatus([boot({ type: 'checklist', pass: 1, blockers: ['no tests'], passing: false })])
  assert.deepEqual(failing, { pass: 1, passing: false, blockers: ['no tests'], productionGrade: false, finished: false })

  const done = loopStatus([
    boot({ type: 'checklist', pass: 1, blockers: ['no tests'], passing: false }),
    boot({ type: 'done', result: { passes: 2, blockers: [], productionGrade: true } }),
  ])
  assert.deepEqual(done, { pass: 2, passing: true, blockers: [], productionGrade: true, finished: true })
})

test('sessionInfo merges the opening session with the latest session-update link (#431)', () => {
  const events: FrameworkEvent[] = [
    { kind: 'session', driver: 'claude', workspace: '/repo', fake: false },
    { kind: 'session-update', sessionId: 'sess-1', sessionLink: 'https://claude.ai/code/sess-1' },
  ]
  const info = sessionInfo(events)
  assert.equal(info?.driver, 'claude')
  assert.equal(info?.sessionId, 'sess-1')
  assert.equal(info?.sessionLink, 'https://claude.ai/code/sess-1')
  assert.equal(sessionInfo([{ kind: 'log', message: 'x' }]), null)
})

test('deployPlan returns the chosen deploy target from the deploy event; latest wins (#433)', () => {
  const boot = (event: Record<string, unknown>): FrameworkEvent => ({ kind: 'bootstrap', event: event as never })
  assert.equal(deployPlan([{ kind: 'log', message: 'x' }]), null) // no deploy yet
  const plan = deployPlan([
    boot({ type: 'deploy', plan: { render: 'ssg', target: 'github-pages', reason: 'static' }, result: { deployed: false } }),
    boot({ type: 'deploy', plan: { render: 'ssr', target: 'dokploy', reason: 'per-request data' }, result: { deployed: true } }),
  ])
  assert.deepEqual(plan, { render: 'ssr', target: 'dokploy', reason: 'per-request data' })
})
