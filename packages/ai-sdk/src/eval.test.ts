import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { aiObservers, type AiEvent } from './observers.js'
import { z } from 'zod'
import {
  evalSuite,
  exactMatch,
  regex,
  llmJudge,
  jsonShape,
  semanticMatch,
  tokenCost,
  compose,
  runSuite,
  reportConsole,
  estimateCost,
  type CaseResult,
  type Metric,
  type SuiteReport,
} from './eval/index.js'

class StubAgent extends Agent {
  instructions() { return 'You are a stub agent.' }
}

// ─── evalSuite() ─────────────────────────────────────────

describe('evalSuite()', () => {
  it('returns a frozen suite with name + spec', () => {
    const s = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [{ input: 'hi', assert: exactMatch('hi') }],
    })
    assert.equal(s.name, 'S')
    assert.equal(typeof s.spec.agent, 'function')
    assert.equal(s.spec.cases.length, 1)
    assert.throws(() => { (s as { name: string }).name = 'X' }, /TypeError|read.only/i)
  })

  it('throws when name is missing', () => {
    assert.throws(() => evalSuite('', { agent: () => new StubAgent(), cases: [{ input: 'x', assert: exactMatch('x') }] }), /name/)
  })

  it('throws when agent factory is missing', () => {
    assert.throws(
      () => evalSuite('S', { cases: [{ input: 'x', assert: exactMatch('x') }] } as unknown as Parameters<typeof evalSuite>[1]),
      /agent: \(\) => Agent/,
    )
  })

  it('throws when cases is empty', () => {
    assert.throws(() => evalSuite('S', { agent: () => new StubAgent(), cases: [] }), /at least one case/)
  })
})

// ─── Built-in metrics ────────────────────────────────────

describe('exactMatch', () => {
  it('passes when text matches exactly', async () => {
    const r = await exactMatch('hello')(stubResponse('hello'), ctx())
    assert.equal(r.pass, true)
    assert.equal(r.score, 1)
  })

  it('fails with reason when text differs', async () => {
    const r = await exactMatch('hello')(stubResponse('world'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /expected "hello", got "world"/)
  })
})

describe('regex', () => {
  it('passes when pattern matches', async () => {
    const r = await regex(/hel+o/)(stubResponse('say hello there'), ctx())
    assert.equal(r.pass, true)
  })

  it('fails with truncated reason for long text', async () => {
    const long = 'x'.repeat(500)
    const r = await regex(/never/)(stubResponse(long), ctx())
    assert.equal(r.pass, false)
    assert.ok(r.reason!.includes('…'), 'reason includes ellipsis for long text')
  })
})

// ─── llmJudge ────────────────────────────────────────────

describe('llmJudge', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => fake.restore())

  it('passes when the judge says pass=true', async () => {
    fake.respondWithSequence([{ text: '{"pass": true, "reason": "mentions reset link"}' }])
    const m = llmJudge('mentions a password reset link', { model: '__fake__/judge' })
    const r = await m(stubResponse('Reset your password at /reset'), ctx('How do I reset?'))
    assert.equal(r.pass, true)
    assert.match(r.reason!, /mentions reset link/)
  })

  it('fails when the judge says pass=false', async () => {
    fake.respondWithSequence([{ text: '{"pass": false, "reason": "no link mentioned"}' }])
    const m = llmJudge('mentions a password reset link', { model: '__fake__/judge' })
    const r = await m(stubResponse('I cannot help with that.'), ctx('How do I reset?'))
    assert.equal(r.pass, false)
    assert.match(r.reason!, /no link mentioned/)
  })

  it('fails (rather than throws) when the judge response is unparseable', async () => {
    fake.respondWithSequence([{ text: 'not json at all' }])
    const m = llmJudge('anything', { model: '__fake__/judge' })
    const r = await m(stubResponse('whatever'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /judge failed/)
  })

  it('fails (rather than throws) when the judge model is missing', async () => {
    // No model registered for `made-up` provider — registry throws
    // inside agent.prompt, llmJudge catches.
    const m = llmJudge('anything', { model: 'made-up/no-such-model' })
    const r = await m(stubResponse('whatever'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /judge failed/)
  })
})

// ─── jsonShape ───────────────────────────────────────────

describe('jsonShape', () => {
  const Schema = z.object({ status: z.literal('ok'), code: z.number() })

  it('passes when text is valid JSON matching the schema', async () => {
    const r = await jsonShape(Schema)(stubResponse('{"status":"ok","code":200}'), ctx())
    assert.equal(r.pass, true)
    assert.equal(r.score, 1)
  })

  it('strips ```json fences before parsing', async () => {
    const fenced = '```json\n{"status":"ok","code":200}\n```'
    const r = await jsonShape(Schema)(stubResponse(fenced), ctx())
    assert.equal(r.pass, true)
  })

  it('strips bare ``` fences too', async () => {
    const fenced = '```\n{"status":"ok","code":200}\n```'
    const r = await jsonShape(Schema)(stubResponse(fenced), ctx())
    assert.equal(r.pass, true)
  })

  it('fails with parse-error reason when text is not JSON', async () => {
    const r = await jsonShape(Schema)(stubResponse('not json at all'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /not JSON/)
  })

  it('fails with schema path + message on shape mismatch', async () => {
    const r = await jsonShape(Schema)(stubResponse('{"status":"bad","code":"oops"}'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /schema mismatch at status/)
  })
})

// ─── semanticMatch ───────────────────────────────────────

describe('semanticMatch', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => fake.restore())

  it('passes when reference + response embeddings are identical', async () => {
    fake.respondWithEmbedding([
      [1, 0, 0],   // reference
      [1, 0, 0],   // response
    ])
    const r = await semanticMatch('hello')(stubResponse('hello'), ctx())
    assert.equal(r.pass, true)
    assert.ok((r.score ?? 0) >= 0.99)
    assert.match(r.reason!, /cosine/)
  })

  it('fails when cosine is below threshold', async () => {
    // 90 degrees apart = cosine 0
    fake.respondWithEmbedding([
      [1, 0, 0],
      [0, 1, 0],
    ])
    const r = await semanticMatch('hello', { threshold: 0.5 })(stubResponse('completely unrelated'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /cosine 0\.000 < 0\.5/)
  })

  it('honors a custom threshold', async () => {
    // Identical pair → cosine 1.0; threshold 0.999 still passes.
    fake.respondWithEmbedding([[1, 1, 1], [1, 1, 1]])
    const r = await semanticMatch('x', { threshold: 0.999 })(stubResponse('x'), ctx())
    assert.equal(r.pass, true)
  })

  it('rolls embed token usage into the response side-channel', async () => {
    fake.respondWithEmbedding([[1, 0], [1, 0]])
    const response = stubResponse('hi')
    await semanticMatch('hi')(response, ctx())
    // The runner consumes via consumeExtraUsage(); we exercise the
    // attach side-effect by checking the symbol slot is set.
    const symbols = Object.getOwnPropertySymbols(response)
    assert.equal(symbols.length, 1, 'extra-usage symbol should be attached')
  })

  it('fails (rather than throws) when no embedding provider is registered', async () => {
    fake.restore()    // remove the fake — registry now has no embed-capable provider
    const r = await semanticMatch('hi')(stubResponse('there'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /embed failed/)
  })
})

// ─── tokenCost ───────────────────────────────────────────

describe('tokenCost', () => {
  it('passes when total tokens <= threshold', async () => {
    const r = await tokenCost(1000)(stubResponse('hi', 487), ctx())
    assert.equal(r.pass, true)
    assert.match(r.reason!, /487 tokens <= 1000/)
  })

  it('fails when total tokens > threshold', async () => {
    const r = await tokenCost(100)(stubResponse('hi', 487), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /487 tokens > 100/)
  })
})

// ─── compose ─────────────────────────────────────────────

describe('compose', () => {
  it('passes when every metric passes', async () => {
    const r = await compose(
      exactMatch('hi'),
      regex(/^h/),
    )(stubResponse('hi'), ctx())
    assert.equal(r.pass, true)
    assert.equal(r.score, 1)
  })

  it('short-circuits on the first failure and surfaces its reason', async () => {
    let secondCalled = false
    const second: Metric = (): Awaited<ReturnType<Metric>> => {
      secondCalled = true
      return { pass: true, score: 1 }
    }
    const r = await compose(
      exactMatch('hi'),                   // fails
      second,
    )(stubResponse('bye'), ctx())
    assert.equal(r.pass, false)
    assert.match(r.reason!, /expected "hi", got "bye"/)
    assert.equal(secondCalled, false, 'second metric must not run after first failure')
  })

  it('awaits async metrics in order', async () => {
    const order: string[] = []
    const m = (label: string, pass: boolean): Metric => async () => {
      await new Promise(r => setTimeout(r, 1))
      order.push(label)
      return { pass, score: pass ? 1 : 0 }
    }
    const r = await compose(m('a', true), m('b', true), m('c', false))(stubResponse('x'), ctx())
    assert.equal(r.pass, false)
    assert.deepEqual(order, ['a', 'b', 'c'])
  })
})

// ─── runSuite ────────────────────────────────────────────

describe('runSuite', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => fake.restore())

  it('reports all-pass for matching cases', async () => {
    fake.respondWithSequence([
      { text: 'A reply' },
      { text: 'B reply' },
    ])
    const suite = evalSuite('AllPass', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'first',  input: 'a', assert: exactMatch('A reply') },
        { name: 'second', input: 'b', assert: exactMatch('B reply') },
      ],
    })
    const report = await runSuite(suite)
    assert.equal(report.passed, 2)
    assert.equal(report.failed, 0)
    assert.equal(report.skipped, 0)
    assert.equal(report.cases.length, 2)
    assert.deepStrictEqual(report.cases.map(c => c.status), ['passed', 'passed'])
  })

  it('reports failures with metric reason', async () => {
    fake.respondWithSequence([
      { text: 'wrong answer' },
    ])
    const suite = evalSuite('OneFail', {
      agent: () => new StubAgent(),
      cases: [{ input: 'q', assert: exactMatch('right answer') }],
    })
    const report = await runSuite(suite)
    assert.equal(report.failed, 1)
    assert.equal(report.cases[0]!.status, 'failed')
    assert.match(report.cases[0]!.metric!.reason!, /right answer/)
  })

  it('runs cases in declaration order', async () => {
    fake.respondWithSequence([
      { text: 'first'  },
      { text: 'second' },
      { text: 'third'  },
    ])
    const suite = evalSuite('Order', {
      agent: () => new StubAgent(),
      cases: [
        { name: '1', input: 'a', assert: exactMatch('first')  },
        { name: '2', input: 'b', assert: exactMatch('second') },
        { name: '3', input: 'c', assert: exactMatch('third')  },
      ],
    })
    const report = await runSuite(suite)
    assert.deepStrictEqual(report.cases.map(c => c.name), ['1', '2', '3'])
  })

  it('supplies default case names when omitted', async () => {
    fake.respondWith('ok')
    const suite = evalSuite('Defaults', {
      agent: () => new StubAgent(),
      cases: [{ input: 'a', assert: exactMatch('ok') }],
    })
    const report = await runSuite(suite)
    assert.equal(report.cases[0]!.name, 'case-0')
  })

  it('skips cases when skip is truthy and never calls agent', async () => {
    fake.respondWith('ok')
    const suite = evalSuite('Skip', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'run',  input: 'a', assert: exactMatch('ok') },
        { name: 'gate', input: 'b', assert: exactMatch('ok'), skip: 'expensive' },
      ],
    })
    const report = await runSuite(suite)
    assert.equal(report.passed, 1)
    assert.equal(report.skipped, 1)
    assert.equal(report.cases[1]!.status, 'skipped')
    assert.equal(report.cases[1]!.reason, 'expensive')
    assert.equal(fake.getCalls().length, 1, 'skipped case did not call agent')
  })

  it('treats agent failures as failed cases (not exceptions)', async () => {
    fake.failOnStep(0, new Error('provider down'))
    const suite = evalSuite('Boom', {
      agent: () => new StubAgent(),
      cases: [{ input: 'q', assert: exactMatch('whatever') }],
    })
    const report = await runSuite(suite)
    assert.equal(report.failed, 1)
    assert.match(report.cases[0]!.metric!.reason!, /provider down/)
  })

  it('treats assertion throws as failed cases (not exceptions)', async () => {
    fake.respondWith('ok')
    const throwingMetric: Metric = () => { throw new Error('boom') }
    const suite = evalSuite('AssertBoom', {
      agent: () => new StubAgent(),
      cases: [{ input: 'q', assert: throwingMetric }],
    })
    const report = await runSuite(suite)
    assert.equal(report.failed, 1)
    assert.match(report.cases[0]!.metric!.reason!, /assert threw: boom/)
  })

  it('honors per-case timeout', async () => {
    // The fake responds instantly, so to exercise the timeout we
    // wrap an agent whose prompt sleeps.
    class SlowAgent extends Agent {
      instructions() { return '' }
      override async prompt(): Promise<never> {
        await new Promise(res => setTimeout(res, 50))
        throw new Error('should never reach here under a timeout')
      }
    }
    const suite = evalSuite('Slow', {
      agent: () => new SlowAgent(),
      cases: [{ input: 'q', assert: exactMatch('x'), timeout: 5 }],
    })
    const report = await runSuite(suite)
    assert.equal(report.failed, 1)
    assert.match(report.cases[0]!.metric!.reason!, /timeout after 5ms/)
  })

  it('per-case agent override replaces the suite factory', async () => {
    fake.respondWithSequence([
      { text: 'from override' },
    ])
    let suiteCalls = 0
    let overrideCalls = 0
    const suite = evalSuite('Override', {
      agent: () => { suiteCalls++; return new StubAgent() },
      cases: [{
        input:  'q',
        assert: exactMatch('from override'),
        agent:  () => { overrideCalls++; return new StubAgent() },
      }],
    })
    await runSuite(suite)
    assert.equal(suiteCalls,    0)
    assert.equal(overrideCalls, 1)
  })

  it('aggregates tokens across cases', async () => {
    fake.respondWithSequence([{ text: 'a' }, { text: 'b' }])
    const suite = evalSuite('Tokens', {
      agent: () => new StubAgent(),
      cases: [
        { input: '1', assert: exactMatch('a') },
        { input: '2', assert: exactMatch('b') },
      ],
    })
    const report = await runSuite(suite)
    // AiFake reports zero tokens by default; tokens still aggregate as 0+0=0.
    assert.equal(report.tokens, 0)
    assert.equal(report.cases.every(c => c.tokens === 0), true)
  })

  it('rolls llmJudge tokens into the case cost row', async () => {
    fake.respondWithSequence([
      { text: 'agent reply' },
      { text: '{"pass": true, "reason": "ok"}' },
    ])
    const suite = evalSuite('JudgeRollup', {
      agent: () => new StubAgent(),
      cases: [{ input: 'q', assert: llmJudge('says ok', { model: '__fake__/judge' }) }],
    })
    const report = await runSuite(suite)
    // Both calls go through the fake which reports 0 tokens, but the
    // mechanism is exercised — the runner consumed the side-channel
    // without leaking it into the response object.
    assert.equal(report.cases[0]!.status, 'passed')
    // Side-channel should have been consumed (and deleted) — no
    // observable EXTRA_USAGE_KEY symbol on the response.
    const symbols = Object.getOwnPropertySymbols(report.cases[0]!)
    assert.equal(symbols.length, 0)
  })
})

// ─── observer events ─────────────────────────────────────

describe('aiObservers — agent.eval.completed', () => {
  let fake: AiFake
  const events: AiEvent[] = []
  let unsub: () => void

  beforeEach(() => {
    fake = AiFake.fake()
    events.length = 0
    unsub = aiObservers.subscribe((e) => { events.push(e) })
  })
  afterEach(() => {
    unsub()
    fake.restore()
  })

  it('emits one event per case with the right shape', async () => {
    fake.respondWithSequence([{ text: 'hi' }, { text: 'wrong' }])
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'pass', input: 'a', assert: exactMatch('hi')      },
        { name: 'fail', input: 'b', assert: exactMatch('expected') },
      ],
    })
    await runSuite(suite)
    const evalEvents = events.filter(e => e.kind === 'agent.eval.completed')
    assert.equal(evalEvents.length, 2)
    const [first, second] = evalEvents as Extract<AiEvent, { kind: 'agent.eval.completed' }>[]
    assert.equal(first!.suite,  'S')
    assert.equal(first!.case,   'pass')
    assert.equal(first!.status, 'passed')
    assert.equal(first!.pass,   true)
    assert.equal(first!.score,  1)
    assert.equal(typeof first!.duration, 'number')
    assert.equal(typeof first!.tokens,   'number')
    assert.equal(typeof first!.cost,     'number')

    assert.equal(second!.status, 'failed')
    assert.equal(second!.pass,   false)
    assert.match(second!.reason!, /expected/)
  })

  it('emits for skipped cases too (so dashboards show coverage gaps)', async () => {
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'soft', input: 'x', assert: exactMatch('x'), skip: true },
        { name: 'hard', input: 'y', assert: exactMatch('y'), skip: 'CI-only' },
      ],
    })
    await runSuite(suite)
    const evalEvents = events.filter(e => e.kind === 'agent.eval.completed') as Extract<AiEvent, { kind: 'agent.eval.completed' }>[]
    assert.equal(evalEvents.length, 2)
    assert.equal(evalEvents[0]!.status, 'skipped')
    assert.equal(evalEvents[0]!.pass,   false)
    // the runner records the skip reason; for `skip: true` it's the literal 'skipped'
    assert.equal(evalEvents[0]!.reason, 'skipped')
    assert.equal(evalEvents[1]!.reason, 'CI-only')
  })

  it('observer errors do not break runSuite', async () => {
    fake.respondWith('hi')
    const noisy = aiObservers.subscribe(() => { throw new Error('observer crash') })
    try {
      const suite = evalSuite('S', {
        agent: () => new StubAgent(),
        cases: [{ input: 'a', assert: exactMatch('hi') }],
      })
      const report = await runSuite(suite)
      assert.equal(report.passed, 1)
    } finally {
      noisy()
    }
  })
})

// ─── estimateCost ────────────────────────────────────────

describe('estimateCost', () => {
  it('returns 0 for unknown models (graceful)', () => {
    assert.equal(estimateCost('made-up/no-model', 1000, 500), 0)
  })

  it('computes Anthropic Haiku correctly', () => {
    // input  $0.0008/1k * 1000 = $0.0008
    // output $0.004/1k  * 500  = $0.002
    // total                    = $0.0028
    const cost = estimateCost('anthropic/claude-haiku-4-5', 1000, 500)
    assert.ok(Math.abs(cost - 0.0028) < 1e-9, `expected ~0.0028, got ${cost}`)
  })

  it('computes OpenAI gpt-4o-mini correctly', () => {
    // input  $0.00015/1k * 2000 = $0.0003
    // output $0.0006/1k  * 1000 = $0.0006
    // total                     = $0.0009
    const cost = estimateCost('openai/gpt-4o-mini', 2000, 1000)
    assert.ok(Math.abs(cost - 0.0009) < 1e-9, `expected ~0.0009, got ${cost}`)
  })
})

// ─── reportConsole ───────────────────────────────────────

describe('reportConsole', () => {
  it('emits the suite summary, per-case glyphs, and totals', async () => {
    const fake = AiFake.fake()
    fake.respondWithSequence([{ text: 'right' }, { text: 'wrong' }])
    try {
      const suite = evalSuite('Demo', {
        agent: () => new StubAgent(),
        cases: [
          { name: 'good', input: 'a', assert: exactMatch('right') },
          { name: 'bad',  input: 'b', assert: exactMatch('right') },
        ],
      })
      const lines: string[] = []
      const report = reportConsole(await runSuite(suite), { log: s => lines.push(s) })

      const out = lines.join('\n')
      assert.match(out, /^Demo \(2 cases/)
      assert.match(out, /✓ good/)
      assert.match(out, /✗ bad/)
      assert.match(out, /1 passed, 1 failed/)
      assert.match(out, /total: \$/)
      // Reporter returns the report unchanged for chaining.
      assert.equal(report.passed, 1)
      assert.equal(report.failed, 1)
    } finally { fake.restore() }
  })

  it('shows skip reason for skipped cases', async () => {
    const fake = AiFake.fake()
    try {
      const suite = evalSuite('Skipped', {
        agent: () => new StubAgent(),
        cases: [{ name: 'expensive', input: 'a', assert: exactMatch('x'), skip: 'CI: too expensive' }],
      })
      const lines: string[] = []
      reportConsole(await runSuite(suite), { log: s => lines.push(s) })
      const out = lines.join('\n')
      assert.match(out, /○ expensive/)
      assert.match(out, /CI: too expensive/)
    } finally { fake.restore() }
  })
})

// ─── Helpers ─────────────────────────────────────────────

function stubResponse(text: string, totalTokens = 0) {
  return {
    text,
    steps: [],
    usage: { promptTokens: 0, completionTokens: totalTokens, totalTokens },
  } as unknown as Parameters<Metric>[0]
}

function ctx(input = 'q', name = 'case-0'): { input: string; caseName: string } {
  return { input, caseName: name }
}

// suppress "unused" — types are exercised implicitly via the runtime
// shape but the imports keep the public surface visible.
type _U = CaseResult | SuiteReport
