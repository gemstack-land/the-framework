import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver } from './driver/index.js'
import { presetCatalog } from './meta-select.js'
import type { DomainPreset } from '@gemstack/ai-autopilot'
import {
  META_SELECT_BENCH_CASES,
  NONE,
  formatMetaSelectBenchReport,
  isAcceptablePick,
  runMetaSelectBench,
  scoreMetaSelectBench,
  type MetaSelectBenchCase,
  type MetaSelectBenchResult,
} from './meta-select-bench.js'

const loop = (on: string[]) => ({ on, run: [] as string[] }) as DomainPreset['loops'][number]
const preset = (name: string): DomainPreset => ({
  name,
  title: name,
  description: `${name} preset`,
  loops: [loop(['major-change'])],
  prompts: [],
  skills: [],
})
const CATALOG = presetCatalog([preset('web-development'), preset('software-development')])

/** Build a result without a live model, to test scoring in isolation. */
function result(expected: string, picked: string): MetaSelectBenchResult {
  return {
    case: { intent: 'x', workspace: 'y', expected, why: 'z' },
    selection: picked === NONE ? { modes: [] } : { preset: picked, modes: [] },
    picked,
    correct: picked === expected,
  }
}

test('scoreMetaSelectBench: accuracy, over-fire, miss, and misroute are tallied distinctly', () => {
  const report = scoreMetaSelectBench([
    result('web-development', 'web-development'), // correct
    result('software-development', 'software-development'), // correct
    result(NONE, 'web-development'), // over-fire
    result('web-development', NONE), // miss
    result('web-development', 'software-development'), // misroute
  ])
  assert.equal(report.total, 5)
  assert.equal(report.correct, 2)
  assert.equal(report.accuracy, 2 / 5)
  assert.deepEqual(report.overFire, { count: 1, of: 1 })
  assert.deepEqual(report.miss, { count: 1, of: 4 }) // 4 cases expected a real preset (only one fell back to none)
  assert.equal(report.misroute, 1)
  assert.deepEqual(report.perExpected['web-development'], { total: 3, correct: 1 })
  assert.deepEqual(report.perExpected[NONE], { total: 1, correct: 0 })
})

test('scoreMetaSelectBench: an empty run is 0/0 with zero accuracy, never NaN', () => {
  const report = scoreMetaSelectBench([])
  assert.equal(report.total, 0)
  assert.equal(report.accuracy, 0)
})

test('runMetaSelectBench drives each case through metaSelect and scores a perfect run', async () => {
  // A scripted driver that "routes" by echoing the expected preset embedded in the intent,
  // so the harness plumbing (session per case, parse, score) is exercised with no model.
  const cases: MetaSelectBenchCase[] = [
    { intent: 'PICK:web-development', workspace: 'w', expected: 'web-development', why: '' },
    { intent: 'PICK:none', workspace: 'w', expected: NONE, why: '' },
  ]
  const driver = new FakeDriver({
    respond: (prompt: string) => {
      const want = /PICK:(\S+)/.exec(prompt)?.[1] ?? NONE
      const preset = want === NONE ? NONE : want
      return '```json\n' + JSON.stringify({ preset, modes: [], event: 'default', why: 'test' }) + '\n```'
    },
  })
  const report = await runMetaSelectBench({ driver, cases, catalog: CATALOG, cwd: '/tmp/ws' })
  assert.equal(report.total, 2)
  assert.equal(report.correct, 2)
  assert.equal(report.accuracy, 1)
})

test('runMetaSelectBench records a misroute when the router picks the wrong preset', async () => {
  const cases: MetaSelectBenchCase[] = [
    { intent: 'a web change', workspace: 'w', expected: 'web-development', why: '' },
  ]
  const driver = new FakeDriver({
    respond: () => '```json\n' + JSON.stringify({ preset: 'software-development', modes: [], why: 'x' }) + '\n```',
  })
  const report = await runMetaSelectBench({ driver, cases, catalog: CATALOG, cwd: '/tmp/ws' })
  assert.equal(report.correct, 0)
  assert.equal(report.misroute, 1)
  assert.equal(report.results[0]!.picked, 'software-development')
})

test('isAcceptablePick: the expected label or a listed alternate counts; anything else does not', () => {
  const c: MetaSelectBenchCase = { intent: 'i', workspace: 'w', expected: 'web-development', alsoAcceptable: ['data-science'], why: '' }
  assert.equal(isAcceptablePick(c, 'web-development'), true)
  assert.equal(isAcceptablePick(c, 'data-science'), true) // defensible alternate
  assert.equal(isAcceptablePick(c, 'software-development'), false) // a real misroute
  assert.equal(isAcceptablePick(c, NONE), false)
})

test('scoreMetaSelectBench: a defensible alternate is correct, not a misroute', () => {
  const crossDomain: MetaSelectBenchResult = {
    case: { intent: 'i', workspace: 'w', expected: 'web-development', alsoAcceptable: ['data-science'], why: '' },
    selection: { preset: 'data-science', modes: [] },
    picked: 'data-science',
    correct: isAcceptablePick({ intent: 'i', workspace: 'w', expected: 'web-development', alsoAcceptable: ['data-science'], why: '' }, 'data-science'),
  }
  const report = scoreMetaSelectBench([crossDomain])
  assert.equal(report.correct, 1)
  assert.equal(report.misroute, 0)
  // The report still shows it diverged from the primary label, transparently.
  assert.match(formatMetaSelectBenchReport(report), /defensible alternates taken/)
  assert.match(formatMetaSelectBenchReport(report), /\[web-development ~ data-science\]/)
})

test('the shipped corpus is well-formed: unique intents, real labels, valid alternates, and both bands present', () => {
  const validExpected = new Set([...CATALOG.map(p => p.name), 'data-science', 'biological-science', 'product-management', NONE])
  const realPresets = new Set([...validExpected].filter(n => n !== NONE))
  const intents = new Set<string>()
  for (const c of META_SELECT_BENCH_CASES) {
    assert.ok(c.intent.trim() && c.workspace.trim() && c.why.trim(), `case missing fields: ${c.intent}`)
    assert.ok(!intents.has(c.intent), `duplicate intent: ${c.intent}`)
    intents.add(c.intent)
    assert.ok(validExpected.has(c.expected), `unknown expected label: ${c.expected}`)
    for (const alt of c.alsoAcceptable ?? []) {
      assert.ok(realPresets.has(alt), `unknown alternate: ${alt}`)
      assert.notEqual(alt, c.expected, `alternate duplicates expected: ${c.intent}`)
    }
  }
  // Both bands are present: the contested 'none' band and genuinely cross-domain cases.
  assert.ok(META_SELECT_BENCH_CASES.some(c => c.expected === NONE), 'corpus should include none cases')
  assert.ok(META_SELECT_BENCH_CASES.some(c => (c.alsoAcceptable?.length ?? 0) > 0), 'corpus should include cross-domain cases')
})

test('formatMetaSelectBenchReport surfaces the headline number and each wrong pick', () => {
  const text = formatMetaSelectBenchReport(
    scoreMetaSelectBench([result('web-development', 'web-development'), result(NONE, 'web-development')]),
  )
  assert.match(text, /1\/2 correct/)
  assert.match(text, /over-fire/)
  assert.match(text, /\[none -> web-development\]/)
})
