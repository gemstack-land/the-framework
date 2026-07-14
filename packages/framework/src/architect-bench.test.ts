import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver } from './driver/index.js'
import {
  ARCHITECT_BENCH_CASES,
  detectFramework,
  formatArchitectBenchReport,
  isComplete,
  isStackFit,
  runArchitectBench,
  scoreArchitectBench,
  type ArchitectBenchCase,
  type ArchitectBenchResult,
} from './architect-bench.js'
import type { ArchitectPlan } from '@gemstack/ai-autopilot'

const plan = (over: Partial<ArchitectPlan> = {}): ArchitectPlan => ({
  stack: 'Next.js + Prisma',
  narration: 'n',
  decisions: [],
  pros: ['fast'],
  cons: ['heavy'],
  alternatives: [{ option: 'Vike', whyNot: 'smaller ecosystem' }],
  ...over,
})

const resultOf = (c: ArchitectBenchCase, p: ArchitectPlan): ArchitectBenchResult => ({
  case: c,
  plan: p,
  stack: p.stack,
  stackFit: isStackFit(c, p.stack),
  complete: isComplete(p),
  framework: detectFramework(p.stack),
})

test('detectFramework picks the named frontend framework, most specific first', () => {
  assert.equal(detectFramework('SvelteKit + Drizzle'), 'sveltekit') // not plain "svelte"
  assert.equal(detectFramework('Next.js (React) + Prisma'), 'next') // not plain "react"
  assert.equal(detectFramework('Vike + Vue'), 'vike')
  assert.equal(detectFramework('Express + Postgres'), 'other')
})

test('isComplete requires a pro, a con, and a rejected alternative', () => {
  assert.equal(isComplete(plan()), true)
  assert.equal(isComplete(plan({ cons: [] })), false)
  assert.equal(isComplete(plan({ alternatives: [] })), false)
  assert.equal(isComplete(plan({ pros: [] })), false)
})

test('isStackFit needs an accept match and no reject match', () => {
  const c: ArchitectBenchCase = { intent: 'i', accept: [/express|fastify/i], reject: [/react|vue/i], why: '' }
  assert.equal(isStackFit(c, 'Fastify + Postgres'), true)
  assert.equal(isStackFit(c, 'Django'), false) // no accept match
  assert.equal(isStackFit(c, 'Express + React admin'), false) // reject match wins
})

test('scoreArchitectBench: web-agnostic cases feed the balance, not the fit rate', () => {
  const category: ArchitectBenchCase = { intent: 'cli', accept: [/node/i], reject: [/react/i], why: '' }
  const agnostic: ArchitectBenchCase = { intent: 'web', accept: [/./], webAgnostic: true, why: '' }
  const report = scoreArchitectBench([
    resultOf(category, plan({ stack: 'Node CLI', pros: ['x'], cons: ['y'], alternatives: [{ option: 'a', whyNot: 'b' }] })),
    resultOf(category, plan({ stack: 'React SPA' })), // unfit (reject match)
    resultOf(agnostic, plan({ stack: 'Vike + React' })),
    resultOf(agnostic, plan({ stack: 'Next.js' })),
  ])
  assert.deepEqual(report.stackFit, { count: 1, of: 2 }) // only the two category cases count toward fit
  assert.deepEqual(report.frameworkBalance, { vike: 1, next: 1 })
  assert.equal(report.complete.of, 4)
})

test('runArchitectBench drives each case through the architect and scores the plan', async () => {
  const cases: ArchitectBenchCase[] = [
    { intent: 'a CLI', accept: [/node|go/i], reject: [/react|vike/i], why: '' },
    { intent: 'a web app', accept: [/./], webAgnostic: true, why: '' },
  ]
  // A scripted driver returning a sane plan for each: a Node CLI, then a Vike web app.
  const replies = [
    { stack: 'Node.js + TypeScript', narration: 'a cli', decisions: [], pros: ['simple'], cons: ['no ui'], alternatives: [{ option: 'Go', whyNot: 'slower to write' }] },
    { stack: 'Vike + React', narration: 'a web app', decisions: [], pros: ['portable'], cons: ['smaller ecosystem'], alternatives: [{ option: 'Next.js', whyNot: 'heavier' }] },
  ]
  let i = 0
  const driver = new FakeDriver({ respond: () => '```json\n' + JSON.stringify(replies[i++]) + '\n```' })
  const report = await runArchitectBench({ driver, cases, cwd: '/tmp/ws' })
  assert.deepEqual(report.stackFit, { count: 1, of: 1 }) // the CLI got a sane, non-web stack
  assert.deepEqual(report.complete, { count: 2, of: 2 }) // both plans had pros + cons + an alternative
  assert.deepEqual(report.frameworkBalance, { vike: 1 })
})

test('the shipped corpus is well-formed: unique intents, an accept pattern each, and both kinds present', () => {
  const intents = new Set<string>()
  for (const c of ARCHITECT_BENCH_CASES) {
    assert.ok(c.intent.trim() && c.why.trim(), `case missing fields: ${c.intent}`)
    assert.ok(!intents.has(c.intent), `duplicate intent: ${c.intent}`)
    intents.add(c.intent)
    assert.ok(c.accept.length > 0, `case has no accept pattern: ${c.intent}`)
  }
  assert.ok(ARCHITECT_BENCH_CASES.some(c => c.webAgnostic), 'corpus should include web-agnostic cases')
  assert.ok(ARCHITECT_BENCH_CASES.some(c => !c.webAgnostic), 'corpus should include category cases')
})

test('formatArchitectBenchReport surfaces the headline, the balance, and questionable stacks', () => {
  const category: ArchitectBenchCase = { intent: 'a CLI tool', accept: [/node/i], reject: [/react/i], why: '' }
  const agnostic: ArchitectBenchCase = { intent: 'a web app', accept: [/./], webAgnostic: true, why: '' }
  const text = formatArchitectBenchReport(
    scoreArchitectBench([resultOf(category, plan({ stack: 'React SPA' })), resultOf(agnostic, plan({ stack: 'Vike' }))]),
  )
  assert.match(text, /sane stacks/)
  assert.match(text, /framework balance/)
  assert.match(text, /questionable stacks/)
  assert.match(text, /\[React SPA\] a CLI tool/)
})
