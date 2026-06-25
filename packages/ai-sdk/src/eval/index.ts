/**
 * `@gemstack/ai-sdk/eval` — built-in eval framework for #A5 Phase 1.
 *
 * Define a suite of input cases + assertions, run them against any
 * `Agent`, get a console report with pass/fail + cost + tokens. Same
 * `Agent` instances as your app code — one source of truth.
 *
 * @example
 * ```ts
 * // evals/support-agent.eval.ts
 * import { evalSuite, llmJudge, exactMatch, regex } from '@gemstack/ai-sdk/eval'
 * import { SupportAgent } from '../app/Agents/SupportAgent.js'
 *
 * export default evalSuite('SupportAgent', {
 *   agent: () => new SupportAgent(),
 *   cases: [
 *     { name: 'password reset', input: 'How do I reset my password?',
 *       assert: llmJudge('mentions a password reset link') },
 *     { name: 'price', input: 'How much?', assert: exactMatch('$99/month') },
 *     { name: 'support email', input: 'Contact?', assert: regex(/support@/) },
 *   ],
 * })
 * ```
 *
 * Run programmatically via `runSuite(suite)` from this entry, or via
 * `pnpm rudder ai:eval` once Phase 2 lands.
 *
 * Built-in metrics: `exactMatch`, `regex`, `llmJudge`, `jsonShape`,
 * `semanticMatch`, `tokenCost`. Compose multiple via `compose(...)`.
 * User-defined metrics work today — any `(response, ctx) =>
 * MetricResult` qualifies.
 */

import { agent } from '../agent.js'
import type { Agent } from '../agent.js'
import type { AgentResponse } from '../types.js'
import { Output } from '../output.js'
import { AI } from '../facade.js'
import { aiObservers } from '../observers.js'
import { estimateCost } from '../budget/pricing.js'
import { z } from 'zod'

export { reportJson } from './json-reporter.js'
export type { SuiteJson, SuiteJsonCase } from './json-reporter.js'
export { stepsFromResponse } from './fixtures.js'
export type { EvalFixture } from './fixtures.js'
export { reportHtml } from './html-reporter.js'
export type { HtmlReportOptions } from './html-reporter.js'

// ─── Types ────────────────────────────────────────────────

/**
 * Result of a single assertion. `pass` is the only required field;
 * `score` (0..1) and `reason` are surfaced in reports.
 */
export interface MetricResult {
  pass:    boolean
  score?:  number
  reason?: string
}

/**
 * Assertion signature. Sync or async; the runner awaits both.
 *
 * `ctx` carries the case context so user metrics can opt into the
 * input/case-name (e.g. for logging). The built-ins ignore it.
 */
export type Metric = (response: AgentResponse, ctx: MetricContext) => MetricResult | Promise<MetricResult>

export interface MetricContext {
  /** The case's input string (the same passed to `agent.prompt`). */
  input:    string
  /** Optional case `name` if set on the spec. */
  caseName: string
}

/** A single eval case. */
export interface EvalCase {
  /** Stable identifier used in reports. Defaults to `case-<index>`. */
  name?: string
  /** Input passed to `agent.prompt(input)`. */
  input: string
  /** The assertion. Pass-fail + optional score/reason. */
  assert: Metric
  /**
   * Per-case agent override. When set, replaces the suite-level
   * `agent` factory for this case (e.g. swap models for a stress
   * test).
   */
  agent?: () => Agent
  /**
   * Per-case timeout in ms. Defaults to the suite-level timeout
   * (or no timeout if neither is set).
   */
  timeout?: number
  /**
   * Skip this case. Pass `true` to silently skip, or a string for
   * a reason that surfaces in the report.
   */
  skip?: boolean | string
}

export interface EvalSuiteSpec {
  /** Factory for the agent under test. Called once per case. */
  agent: () => Agent
  /** The cases to run. */
  cases: EvalCase[]
  /**
   * Suite-wide timeout in ms applied to every case unless the case
   * overrides. Throws cause `pass: false` with the timeout message.
   */
  timeout?: number
  /**
   * Optional ownership / context surfaced in the HTML report (#A5
   * Phase 5). Well-known keys (`owner`, `lastReviewed`, `ticket`)
   * get formatted headings; any extra string keys render as a
   * generic key/value row so teams can attach their own metadata.
   */
  metadata?: EvalMetadata
}

export interface EvalMetadata {
  owner?:        string
  lastReviewed?: string
  ticket?:       string
  [key: string]: string | undefined
}

export interface EvalSuite {
  name: string
  spec: EvalSuiteSpec
}

/** Per-case run record collected by {@link runSuite}. */
export interface CaseResult {
  name:    string
  /** Final result; `'skipped'` skips assertion + cost. */
  status:  'passed' | 'failed' | 'skipped'
  metric?: MetricResult
  /** Skip reason (when `status === 'skipped'`). */
  reason?: string
  /** Wall-clock ms for the agent call + assertion. */
  duration: number
  /**
   * Token usage from the agent's `prompt()` (zero on skip / failure
   * before the call). Includes BOTH the agent under test AND any
   * judge-model calls the assertion made.
   */
  tokens:  number
  /** USD estimate (see {@link estimateCost}; zero on skip). */
  cost:    number
  /**
   * The case's input string, copied through from `EvalCase.input`
   * for reporters that want to render the prompt alongside the
   * response (#A5 Phase 5 HTML report). Always present — runners
   * always know the input.
   */
  input:   string
  /**
   * The agent's final assistant text. Absent when the case skipped
   * or the agent threw before producing a response. The HTML
   * reporter renders `<no response>` in that case.
   */
  responseText?: string
}

/** Full report returned by {@link runSuite}. */
export interface SuiteReport {
  suite:    string
  cases:    CaseResult[]
  passed:   number
  failed:   number
  skipped:  number
  duration: number
  cost:     number
  tokens:   number
  /** Suite-level metadata (#A5 Phase 5), copied through from the spec. */
  metadata?: EvalMetadata
}

// ─── Suite definition ─────────────────────────────────────

/**
 * Define an eval suite. Returns a frozen `EvalSuite` ready to pass
 * into {@link runSuite} or to default-export from an `evals/*.eval.ts`
 * file (Phase 2's CLI auto-discovers those).
 *
 * The shape is deliberately a function rather than a class — keeps the
 * file's default export trivially serializable (Phase 2 needs to load
 * suites via dynamic import) and avoids the "did you forget `new`?"
 * footgun.
 */
export function evalSuite(name: string, spec: EvalSuiteSpec): EvalSuite {
  if (!name) throw new Error('[Rudder AI] evalSuite() requires a name.')
  if (!spec || typeof spec.agent !== 'function') {
    throw new Error('[Rudder AI] evalSuite() requires { agent: () => Agent, cases: [...] }.')
  }
  if (!Array.isArray(spec.cases) || spec.cases.length === 0) {
    throw new Error('[Rudder AI] evalSuite() requires at least one case.')
  }
  return Object.freeze({ name, spec })
}

// ─── Built-in metrics ─────────────────────────────────────

/** Exact string equality against `response.text`. */
export function exactMatch(expected: string): Metric {
  return (response): MetricResult => {
    const actual = response.text
    if (actual === expected) return { pass: true, score: 1 }
    return {
      pass:   false,
      score:  0,
      reason: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    }
  }
}

/** Pattern match against `response.text`. */
export function regex(pattern: RegExp): Metric {
  return (response): MetricResult => {
    if (pattern.test(response.text)) return { pass: true, score: 1 }
    return {
      pass:   false,
      score:  0,
      reason: `pattern ${pattern} did not match ${JSON.stringify(response.text.slice(0, 120))}${response.text.length > 120 ? '…' : ''}`,
    }
  }
}

/**
 * LLM-as-judge: ask a small model whether the response satisfies a
 * natural-language criterion. Returns the judge's reasoning in
 * `reason` so failures are debuggable.
 *
 * Design: the judge runs as a one-shot anonymous agent (no recursion
 * concern — default `remembers()` is `false`). Output is shaped via
 * `Output.object({ schema })` for deterministic parsing. Failures
 * (network, parse, unhandled judge error) bubble as `pass: false`
 * with the error in `reason` — a broken judge is not a passing case.
 *
 * Pitfall: the judge model has the same biases as any LLM. Use it
 * for fuzzy "did the answer mention X?" assertions; for exact
 * structural checks prefer `jsonShape` (Phase 3) or `regex`.
 */
export function llmJudge(criterion: string, opts: { model?: string } = {}): Metric {
  const wrapper = Output.object({
    schema: z.object({
      pass:   z.boolean(),
      reason: z.string(),
    }),
  })

  return async (response, ctx): Promise<MetricResult> => {
    try {
      const judge = agent({
        instructions: `${JUDGE_INSTRUCTIONS}\n\n${wrapper.toSystemPrompt()}`,
        ...(opts.model ? { model: opts.model } : {}),
      })

      const prompt = [
        `Criterion: ${criterion}`,
        '',
        `User input: ${JSON.stringify(ctx.input)}`,
        `Agent response: ${JSON.stringify(response.text)}`,
        '',
        'Does the response satisfy the criterion? Return strictly valid JSON.',
      ].join('\n')

      const judgeResponse = await judge.prompt(prompt)
      const parsed = wrapper.parse(judgeResponse.text)

      // Tag the judge's token usage onto the response so the runner
      // can include it in the cost rollup. This is a side-channel
      // since the metric signature doesn't surface usage natively.
      attachExtraUsage(response, judgeResponse.usage.totalTokens)

      return {
        pass:   parsed.pass,
        score:  parsed.pass ? 1 : 0,
        reason: parsed.reason,
      }
    } catch (err) {
      return {
        pass:   false,
        score:  0,
        reason: `judge failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

const JUDGE_INSTRUCTIONS = [
  'You are an evaluator judging whether an agent response satisfies a natural-language criterion.',
  'Be precise: only return pass=true if the criterion is plainly met.',
  'Provide a short reason for your decision (1-2 sentences) so the developer can debug failures.',
].join(' ')

/**
 * Strict structural assertion: parse `response.text` as JSON
 * (stripping ```json fences) and run it through a zod schema.
 *
 * Pairs naturally with `Output.object({ schema })` on the agent —
 * if the agent declares the same schema, this metric verifies the
 * output actually conforms. Failures surface the zod issue path
 * (e.g. `customer.email`) so debugging doesn't require a separate
 * console log.
 */
export function jsonShape<T>(schema: z.ZodType<T>): Metric {
  return (response): MetricResult => {
    const stripped = stripCodeFences(response.text)
    let parsed: unknown
    try {
      parsed = JSON.parse(stripped)
    } catch (err) {
      return {
        pass:   false,
        score:  0,
        reason: `not JSON: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
    const result = schema.safeParse(parsed)
    if (result.success) return { pass: true, score: 1 }
    const first = result.error.issues[0]
    const path  = first?.path.join('.') || '<root>'
    return {
      pass:   false,
      score:  0,
      reason: `schema mismatch at ${path}: ${first?.message ?? 'unknown error'}`,
    }
  }
}

/**
 * Embedding-based fuzzy match. Embeds both `reference` and
 * `response.text` via `AI.embed()`, computes cosine similarity,
 * passes when >= `threshold` (default `0.85` — tighter than
 * `EmbeddingUserMemory`'s 0.5 retrieval-rank floor since this is
 * an assertion, not a ranking).
 *
 * Uses ≤ 2 embedding calls per case; embed tokens roll into the
 * case's cost rollup via the same side-channel `llmJudge` uses.
 *
 * Pitfall: requires a provider that implements `createEmbedding()`
 * (openai / google / mistral / cohere / jina). Failures (no
 * provider, network, etc.) surface as `pass: false` with the
 * error in `reason` — a broken embed is not a passing case.
 */
export function semanticMatch(
  reference: string,
  opts: { threshold?: number; model?: string } = {},
): Metric {
  const threshold = opts.threshold ?? 0.85
  return async (response): Promise<MetricResult> => {
    try {
      const inputs = [reference, response.text]
      const embedOpts: { model?: string } = {}
      if (opts.model) embedOpts.model = opts.model
      const result = await AI.embed(inputs, embedOpts)
      const [refVec, respVec] = result.embeddings
      if (!refVec || !respVec) {
        return { pass: false, score: 0, reason: 'embed returned no vectors' }
      }
      attachExtraUsage(response, result.usage.totalTokens)

      const score = cosineSimilarity(refVec, respVec)
      const pass  = score >= threshold
      return {
        pass,
        score,
        reason: pass
          ? `cosine ${score.toFixed(3)} >= ${threshold}`
          : `cosine ${score.toFixed(3)} < ${threshold} (reference: ${JSON.stringify(reference.slice(0, 80))}${reference.length > 80 ? '…' : ''})`,
      }
    } catch (err) {
      return {
        pass:   false,
        score:  0,
        reason: `embed failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

/**
 * Token budget guard. Passes when `response.usage.totalTokens
 * <= threshold`. Pair with cost-conscious agents to detect prompt-
 * size regressions before they show up as a billing surprise.
 *
 * `response.usage` is the multi-step rollup, so it's meaningful
 * even when the agent runs tools across several provider calls.
 */
export function tokenCost(threshold: number): Metric {
  return (response): MetricResult => {
    const used = response.usage.totalTokens
    const pass = used <= threshold
    return {
      pass,
      score:  pass ? 1 : 0,
      reason: pass
        ? `${used} tokens <= ${threshold}`
        : `${used} tokens > ${threshold}`,
    }
  }
}

/**
 * Compose multiple metrics into one assertion. Runs them in order
 * and short-circuits on the first failure — failure `reason` is
 * surfaced; success returns `{ pass: true, score: 1 }`.
 *
 * @example
 *   { input: '…',
 *     assert: compose(
 *       jsonShape(SummarySchema),
 *       tokenCost(800),
 *     ),
 *   }
 */
export function compose(...metrics: Metric[]): Metric {
  return async (response, ctx): Promise<MetricResult> => {
    for (const m of metrics) {
      const result = await m(response, ctx)
      if (!result.pass) return result
    }
    return { pass: true, score: 1 }
  }
}

/** Local cosine — kept inline so `eval/` doesn't pull in `memory-embedding` (which depends on `@rudderjs/orm`). */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot  = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!
    const bi = b[i]!
    dot  += ai * bi
    magA += ai * ai
    magB += bi * bi
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim()
}

// ─── Runner ───────────────────────────────────────────────

/**
 * Run every case in the suite, in declaration order. Returns the
 * full report; never throws (assertion errors become `failed` cases,
 * not exceptions).
 *
 * Phase 1 runs serially. Parallel execution lands in a follow-up
 * once we understand the rate-limit shape of real-world judge
 * models — sequential is correct under any rate limit.
 */
export async function runSuite(suite: EvalSuite): Promise<SuiteReport> {
  const start = performance.now()
  const cases: CaseResult[] = []
  let passed  = 0
  let failed  = 0
  let skipped = 0

  for (let i = 0; i < suite.spec.cases.length; i++) {
    const c    = suite.spec.cases[i]!
    const name = c.name ?? `case-${i}`

    if (c.skip) {
      const skipResult: CaseResult = {
        name,
        status:   'skipped',
        reason:   typeof c.skip === 'string' ? c.skip : 'skipped',
        duration: 0,
        tokens:   0,
        cost:     0,
        input:    c.input,
      }
      cases.push(skipResult)
      emitEvalCompleted(suite.name, skipResult)
      skipped++
      continue
    }

    const result = await runCase(suite, c, name)
    cases.push(result)
    emitEvalCompleted(suite.name, result)
    if (result.status === 'passed') passed++
    else if (result.status === 'failed') failed++
  }

  const duration = performance.now() - start

  const report: SuiteReport = {
    suite: suite.name,
    cases,
    passed,
    failed,
    skipped,
    duration,
    cost:   cases.reduce((sum, c) => sum + c.cost,   0),
    tokens: cases.reduce((sum, c) => sum + c.tokens, 0),
  }
  if (suite.spec.metadata) report.metadata = suite.spec.metadata
  return report
}

function emitEvalCompleted(suiteName: string, result: CaseResult): void {
  const event: Parameters<typeof aiObservers.emit>[0] = {
    kind:     'agent.eval.completed',
    suite:    suiteName,
    case:     result.name,
    status:   result.status,
    pass:     result.status === 'passed',
    tokens:   result.tokens,
    cost:     result.cost,
    duration: result.duration,
  }
  if (result.metric?.score !== undefined) event.score = result.metric.score
  const reason = result.status === 'skipped' ? result.reason : result.metric?.reason
  if (reason) event.reason = reason
  aiObservers.emit(event)
}

async function runCase(suite: EvalSuite, c: EvalCase, name: string): Promise<CaseResult> {
  const factory = c.agent ?? suite.spec.agent
  const ag      = factory()
  const timeout = c.timeout ?? suite.spec.timeout

  const start = performance.now()
  let response: AgentResponse
  try {
    response = await runWithTimeout(() => ag.prompt(c.input), timeout)
  } catch (err) {
    return {
      name,
      status:   'failed',
      metric:   { pass: false, reason: err instanceof Error ? err.message : String(err) },
      duration: performance.now() - start,
      tokens:   0,
      cost:     0,
      input:    c.input,
    }
  }

  let metric: MetricResult
  try {
    metric = await c.assert(response, { input: c.input, caseName: name })
  } catch (err) {
    metric = { pass: false, reason: `assert threw: ${err instanceof Error ? err.message : String(err)}` }
  }

  const extraTokens = consumeExtraUsage(response)
  const totalTokens = response.usage.totalTokens + extraTokens

  return {
    name,
    status:       metric.pass ? 'passed' : 'failed',
    metric,
    duration:     performance.now() - start,
    tokens:       totalTokens,
    cost:         estimateCost(modelStringFor(ag), response.usage.promptTokens, response.usage.completionTokens)
                + estimateCost(modelStringFor(ag), 0, extraTokens),  // judge/embed cost approximated as completion-side
    input:        c.input,
    responseText: response.text,
  }
}

function modelStringFor(ag: Agent): string {
  // `Agent.model()` may return undefined → callers fall back to the
  // registry default. We don't have a stable hook for the default
  // here without importing the registry; the eval flow doesn't
  // strictly need the resolved model for cost estimation as long as
  // the user's agent declares one. When it doesn't, costs fall back
  // to an unknown-model rate (zero in Phase 1).
  return ag.model() ?? 'unknown/unknown'
}

async function runWithTimeout<T>(fn: () => Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms || ms <= 0) return fn()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    fn().then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

// ─── Pricing ──────────────────────────────────────────────

// Pricing catalog + estimator live in `../budget/pricing.ts` and are
// re-exported here so `import { estimateCost } from '@gemstack/ai-sdk/eval'`
// continues to work. (Note: estimateCost is also imported at the top
// of this file for use by `runSuite`.)
export { estimateCost, ModelPricing } from '../budget/pricing.js'
export type { ModelPriceEntry } from '../budget/pricing.js'

// ─── Console reporter ─────────────────────────────────────

/**
 * Default reporter — prints a colorless ANSI-aware table to a
 * caller-supplied `console`-like sink. Uses Unicode pass/fail glyphs
 * for visual scanning. JSON / HTML reporters land in Phase 2 / 5.
 *
 * Returns the report unchanged so chains compose: `await
 * reportConsole(await runSuite(suite))`.
 */
export function reportConsole(report: SuiteReport, sink: { log: (s: string) => void } = console): SuiteReport {
  const lines: string[] = []
  const summary = `${report.suite} (${report.cases.length} cases, ${formatMs(report.duration)}, ${formatCost(report.cost)})`
  lines.push(summary)

  for (const c of report.cases) {
    const glyph = c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '○'
    const meta  = c.status === 'skipped'
      ? `skip: ${c.reason ?? 'skipped'}`
      : `${formatMs(c.duration)}   ${formatCost(c.cost)}   tokens: ${c.tokens}`
    lines.push(`  ${glyph} ${padName(c.name)} ${meta}`)
    if (c.status === 'failed' && c.metric?.reason) {
      // Indent reason on its own line so long messages don't break alignment.
      for (const line of c.metric.reason.split('\n')) {
        lines.push(`      ${line}`)
      }
    }
  }

  lines.push('')
  lines.push(`  ${report.passed} passed, ${report.failed} failed${report.skipped > 0 ? `, ${report.skipped} skipped` : ''}`)
  lines.push(`  total: ${formatCost(report.cost)}  •  cumulative tokens: ${report.tokens}`)

  for (const line of lines) sink.log(line)
  return report
}

function padName(s: string): string {
  return s.padEnd(28)
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(cents: number): string {
  if (cents === 0) return '$0.000'
  if (cents < 0.001) return '<$0.001'
  return `$${cents.toFixed(3)}`
}

// ─── Internal: extra-usage side-channel ───────────────────
//
// `Metric` doesn't surface token usage in its return type — the
// signature is `(response, ctx) => MetricResult`. To roll auxiliary
// token costs (llmJudge's judge model, semanticMatch's embeddings)
// into the case's cost report, the metrics stamp usage onto a
// Symbol-keyed slot on the response object and the runner consumes
// it. Internal-only; never exported.

const EXTRA_USAGE_KEY = Symbol.for('rudderjs.ai.eval.extraUsage')

interface ExtraUsageCarrier {
  [EXTRA_USAGE_KEY]?: number
}

function attachExtraUsage(response: AgentResponse, tokens: number): void {
  const carrier = response as AgentResponse & ExtraUsageCarrier
  carrier[EXTRA_USAGE_KEY] = (carrier[EXTRA_USAGE_KEY] ?? 0) + tokens
}

function consumeExtraUsage(response: AgentResponse): number {
  const carrier = response as AgentResponse & ExtraUsageCarrier
  const tokens  = carrier[EXTRA_USAGE_KEY] ?? 0
  delete carrier[EXTRA_USAGE_KEY]
  return tokens
}
