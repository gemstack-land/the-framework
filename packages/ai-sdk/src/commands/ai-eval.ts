/**
 * `pnpm rudder ai:eval` — discover `evals/**\/*.eval.ts` suites,
 * run each, and report. Console reporter by default; `--json` emits
 * a machine-readable envelope to stdout for CI.
 *
 * Registered from the CLI loader (`packages/cli/src/index.ts`)
 * — the AiProvider doesn't own this so it surfaces even when the
 * user app fails to boot, matching the `command:list --json`
 * graceful-degradation pattern from #349.
 */

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runSuite, reportConsole, evalSuite, stepsFromResponse } from '../eval/index.js'
import type { EvalSuite, EvalCase, Metric, SuiteReport } from '../eval/index.js'
import { reportJson } from '../eval/json-reporter.js'
import type { SuiteJson } from '../eval/json-reporter.js'
import { reportHtml } from '../eval/html-reporter.js'
import { defaultFixturesDir, readFixture, writeFixture } from '../eval/fixtures.js'
import { AiFake } from '../fake.js'
import type { AiFakeStep } from '../fake.js'
import type { Agent } from '../agent.js'
import type { AgentResponse } from '../types.js'

type Rudder = {
  command(
    name: string,
    handler: (args: string[]) => void | Promise<void>,
  ): { description(text: string): unknown }
}

/** CLI flags + positional name filter. */
export interface AiEvalOptions {
  /** Substring filter (case-insensitive) applied to suite names. */
  filter?: string
  /** Stop on the first failing suite. */
  bail:    boolean
  /** Emit `{ suites: [...] }` JSON to stdout. */
  json:    boolean
  /**
   * Run against the real provider, capture each case's assistant
   * turns to `evals/__fixtures__/<suite>/<case>.json`. Existing
   * fixtures are overwritten — diff in your VCS to see what changed.
   * Default `false`.
   */
  record?: boolean
  /**
   * Swap the runtime with `AiFake.fake()` and feed each case its
   * recorded fixture via `respondWithSequence`. Zero API calls,
   * deterministic regression tests. Cases without a fixture fall
   * through to a normal run with a stderr warning. Default `false`.
   */
  replay?: boolean
  /**
   * Path for a self-contained HTML report (#A5 Phase 5). Pasteable
   * into PR comments / Slack threads. Coexists with `--json` (JSON
   * still goes to stdout, HTML goes to disk).
   */
  html?: string
}

/**
 * Test seam — every external dependency gets an injectable
 * override. The CLI handler defaults each to its real impl.
 */
export interface AiEvalDeps {
  cwd?:        string
  stdout?:     { write(s: string): boolean | void }
  stderr?:     { write(s: string): boolean | void }
  /** Override the file walk (test harness returns a virtual list). */
  discover?:   (cwd: string, pattern: string) => Promise<string[]>
  /** Override file → suite loader (test harness uses an in-memory map). */
  loadSuite?:  (absPath: string) => Promise<EvalSuite | null>
  /** Override config lookup (test harness skips `@rudderjs/core`). */
  configPattern?: () => string | null | Promise<string | null>
  /**
   * Override fixtures directory (defaults to `<cwd>/evals/__fixtures__`).
   * Tests point to a tmpdir to keep round-trips off the source tree.
   */
  fixturesDir?: string
}

/** Register the `ai:eval` command on the rudder runner. */
export function registerAiEvalCommand(rudder: Rudder): void {
  rudder.command('ai:eval', async (rawArgs: string[]) => {
    const code = await runEvalCli(parseArgs(rawArgs))
    if (code !== 0) process.exit(code)
  }).description(
    'Run eval suites — pnpm rudder ai:eval [name-pattern] [--bail] [--json] [--record|--replay] [--html <path>]',
  )
}

// ─── Args parser ─────────────────────────────────────────

const VALUE_FLAGS = new Set(['--html'])

/**
 * Parse the rest-of-line. Recognizes:
 *  - boolean flags: `--bail`, `--json`, `--record`, `--replay`
 *  - value flags  : `--html <path>` or `--html=<path>`
 *  - one positional name filter (anything not consumed above)
 */
export function parseArgs(args: string[]): AiEvalOptions {
  const positional: string[] = []
  const opts: AiEvalOptions = { bail: false, json: false }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (!a.startsWith('--')) { positional.push(a); continue }

    // `--flag=value` form
    const eq = a.indexOf('=')
    const name  = eq >= 0 ? a.slice(0, eq) : a
    const inline = eq >= 0 ? a.slice(eq + 1) : undefined

    if (name === '--bail')   { opts.bail = true; continue }
    if (name === '--json')   { opts.json = true; continue }
    if (name === '--record') { opts.record = true; continue }
    if (name === '--replay') { opts.replay = true; continue }
    if (VALUE_FLAGS.has(name)) {
      const value = inline ?? args[i + 1]
      if (!inline) i++   // consumed the next arg
      if (!value) throw new Error(`[ai-sdk] ${name} requires a value`)
      if (name === '--html') opts.html = value
      continue
    }
    // unknown flag — surface as positional so the user sees the typo
    positional.push(a)
  }

  if (positional[0]) opts.filter = positional[0]
  return opts
}

// ─── Runner ──────────────────────────────────────────────

/**
 * Execute the CLI flow. Returns the process exit code (0 = all pass,
 * 1 = at least one suite had a failure or no suites discovered).
 *
 * The handler is `process.exit`-free so tests can drive it directly.
 */
export async function runEvalCli(opts: AiEvalOptions, deps: AiEvalDeps = {}): Promise<number> {
  const cwd    = deps.cwd ?? process.cwd()
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr

  if (opts.record && opts.replay) {
    stderr.write('[ai:eval] --record and --replay are mutually exclusive\n')
    return 1
  }

  const pattern = await Promise.resolve((deps.configPattern ?? loadConfigPattern)()) ?? 'evals/**/*.eval.ts'
  const discover = deps.discover ?? discoverSuiteFiles
  const files    = await discover(cwd, pattern)

  if (files.length === 0) {
    stderr.write(`[ai:eval] no suites found matching ${pattern}\n`)
    return opts.json ? emitJson(stdout, []) : 1
  }

  const loader      = deps.loadSuite ?? defaultSuiteLoader
  const fixturesDir = deps.fixturesDir ?? defaultFixturesDir(cwd)
  const reports: SuiteJson[] = []
  const fullReports: SuiteReport[] = []
  let exitCode = 0

  // `--replay` swaps the global runtime once, restored when we're done.
  // The per-case fixture is set on the AiFake instance inside the
  // wrapped agent factory just before each case's `agent.prompt()`.
  let fake: AiFake | null = null
  if (opts.replay) fake = AiFake.fake()

  try {
    for (const file of files) {
      let suite: EvalSuite | null
      try {
        suite = await loader(file)
      } catch (err) {
        stderr.write(`[ai:eval] failed to load ${path.relative(cwd, file)}: ${formatError(err)}\n`)
        exitCode = 1
        if (opts.bail) break
        continue
      }
      if (!suite) {
        stderr.write(`[ai:eval] ${path.relative(cwd, file)} has no default eval suite — skipping\n`)
        continue
      }

      if (opts.filter && !suite.name.toLowerCase().includes(opts.filter.toLowerCase())) continue

      const decorated = await decorateForMode(suite, opts, { fixturesDir, stderr, fake })
      const report = await runSuite(decorated)
      fullReports.push(report)
      if (opts.json) {
        reports.push(reportJson(report))
      } else {
        reportConsole(report, { log: (s) => stdout.write(`${s}\n`) })
      }

      if (report.failed > 0) {
        exitCode = 1
        if (opts.bail) break
      }
    }
  } finally {
    if (fake) fake.restore()
  }

  if (opts.json) emitJson(stdout, reports)
  if (opts.html) await writeHtmlReport(opts.html, fullReports, cwd, stderr)
  return exitCode
}

async function writeHtmlReport(
  htmlPath:    string,
  reports:     SuiteReport[],
  cwd:         string,
  stderr:      { write(s: string): boolean | void },
): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const abs = path.isAbsolute(htmlPath) ? htmlPath : path.resolve(cwd, htmlPath)
  try {
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, reportHtml(reports))
    stderr.write(`[ai:eval] wrote HTML report → ${path.relative(cwd, abs)}\n`)
  } catch (err) {
    stderr.write(`[ai:eval] failed to write HTML report ${abs}: ${formatError(err)}\n`)
  }
}

function emitJson(stdout: { write(s: string): boolean | void }, suites: SuiteJson[]): 0 {
  stdout.write(`${JSON.stringify({ suites }, null, 2)}\n`)
  return 0
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ─── Record / replay decoration ───────────────────────────

interface DecorateContext {
  fixturesDir: string
  stderr:      { write(s: string): boolean | void }
  fake:        AiFake | null
}

/**
 * Wrap a suite so each case captures the response (`--record`) or
 * pre-loads the fake's sequence (`--replay`) before running. A
 * normal run returns the suite untouched.
 *
 * Implemented as a per-case `agent` / `assert` decoration so the
 * runner stays unchanged — `runSuite` doesn't need to know about
 * the fixture format. The original `agent`/`assert` for each case
 * are still called; we just slip work in around them.
 *
 * For replay, fixtures load up-front (sync factory contract) so the
 * AiFake is primed before each `agent.prompt()` runs.
 */
async function decorateForMode(
  suite: EvalSuite,
  opts:  AiEvalOptions,
  ctx:   DecorateContext,
): Promise<EvalSuite> {
  if (!opts.record && !opts.replay) return suite

  // Pre-load every fixture for replay so the per-case factory can
  // call `respondWithSequence` synchronously.
  const replaySteps = new Map<string, AiFakeStep[]>()
  if (opts.replay) {
    for (let i = 0; i < suite.spec.cases.length; i++) {
      const c = suite.spec.cases[i]!
      const caseName = c.name ?? `case-${i}`
      try {
        const fixture = await readFixture(ctx.fixturesDir, suite.name, caseName)
        if (fixture) replaySteps.set(caseName, fixture.steps)
        else ctx.stderr.write(
          `[ai:eval] no fixture for ${suite.name}/${caseName} — running against live provider\n`,
        )
      } catch (err) {
        ctx.stderr.write(`[ai:eval] fixture load error for ${suite.name}/${caseName}: ${formatError(err)}\n`)
      }
    }
  }

  const wrapped = suite.spec.cases.map((c, i): EvalCase => {
    const caseName    = c.name ?? `case-${i}`
    const baseFactory = c.agent ?? suite.spec.agent
    const baseAssert  = c.assert

    const factory = opts.replay
      ? wrapReplayFactory(baseFactory, replaySteps.get(caseName), ctx.fake)
      : baseFactory

    const assert: Metric = opts.record
      ? wrapRecordAssert(baseAssert, suite.name, caseName, c.input, ctx)
      : baseAssert

    const out: EvalCase = {
      input:  c.input,
      assert,
      agent:  factory,
    }
    if (c.name)               out.name    = c.name
    if (c.timeout !== undefined) out.timeout = c.timeout
    if (c.skip   !== undefined) out.skip    = c.skip
    return out
  })

  const newSpec: typeof suite.spec = {
    agent: suite.spec.agent,
    cases: wrapped,
  }
  if (suite.spec.timeout !== undefined) newSpec.timeout = suite.spec.timeout
  return evalSuite(suite.name, newSpec)
}

/**
 * Replay path: before each case runs, prime the shared `AiFake`
 * with the case's recorded steps. When the fixture is missing the
 * factory still returns the agent — it'll hit whatever the AiFake
 * is currently scripted to return (typically falling back to the
 * default ambient response, which surfaces as an obvious diff in
 * the case's assertion).
 */
function wrapReplayFactory(
  base:  () => Agent,
  steps: AiFakeStep[] | undefined,
  fake:  AiFake | null,
): () => Agent {
  return () => {
    if (fake && steps) fake.respondWithSequence(steps)
    return base()
  }
}

/**
 * Record path: after each case's assertion runs, capture the
 * agent response's assistant turns to the fixture file. Wrapping
 * the assert is the cleanest hook — the runner already passes
 * `response` into it, and the wrapped fn still returns the
 * original assertion's result.
 */
function wrapRecordAssert(
  base:     Metric,
  suite:    string,
  caseName: string,
  input:    string,
  ctx:      DecorateContext,
): Metric {
  return async (response: AgentResponse, mctx) => {
    try {
      const file = await writeFixture(ctx.fixturesDir, suite, caseName, {
        input,
        steps: stepsFromResponse(response),
      })
      ctx.stderr.write(`[ai:eval] recorded ${path.relative(process.cwd(), file)}\n`)
    } catch (err) {
      ctx.stderr.write(`[ai:eval] failed to record ${suite}/${caseName}: ${formatError(err)}\n`)
    }
    return base(response, mctx)
  }
}

// ─── File discovery ──────────────────────────────────────

/**
 * Recursive walk constrained to a `<dir>/**\/*<suffix>` shape.
 * Returns absolute paths sorted lexicographically for stable test
 * output and predictable `--bail` ordering.
 */
export async function discoverSuiteFiles(cwd: string, pattern: string): Promise<string[]> {
  const { root, suffix } = parsePattern(pattern)
  const absRoot = path.resolve(cwd, root)
  const out: string[] = []
  await walk(absRoot, suffix, out)
  return out.sort()
}

/**
 * Tiny pattern parser — supports `<dir>/**\/*<suffix>` and bare
 * `*<suffix>` (current directory). Anything more elaborate is
 * deferred to userland (run a custom script that imports `runSuite`).
 *
 * Examples:
 *   `evals/**\/*.eval.ts`     → root=`evals`,    suffix=`.eval.ts`
 *   `tests/agents/**\/*.ts`   → root=`tests/agents`, suffix=`.ts`
 *   `*.eval.ts`               → root=`.`,        suffix=`.eval.ts`
 */
function parsePattern(pattern: string): { root: string; suffix: string } {
  const doubleStar = pattern.indexOf('**')
  let prefix:  string
  let postfix: string
  if (doubleStar >= 0) {
    prefix  = pattern.slice(0, doubleStar).replace(/\/$/, '')
    postfix = pattern.slice(doubleStar + 2).replace(/^\//, '')
  } else {
    const lastSlash = pattern.lastIndexOf('/')
    prefix  = lastSlash >= 0 ? pattern.slice(0, lastSlash) : ''
    postfix = lastSlash >= 0 ? pattern.slice(lastSlash + 1) : pattern
  }
  if (!postfix.startsWith('*')) {
    throw new Error(
      `[ai-sdk] Unsupported eval pattern "${pattern}". ` +
      `Expected <dir>/**/*<suffix> or *<suffix>.`,
    )
  }
  return {
    root:   prefix || '.',
    suffix: postfix.slice(1),
  }
}

async function walk(dir: string, suffix: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      await walk(p, suffix, out)
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(p)
    }
  }
}

// ─── Suite loader ────────────────────────────────────────

async function defaultSuiteLoader(file: string): Promise<EvalSuite | null> {
  const mod = await import(pathToFileURL(file).href) as Record<string, unknown>
  const candidate = (mod['default'] ?? mod['suite']) as EvalSuite | undefined
  if (!candidate || typeof candidate.name !== 'string' || !candidate.spec) return null
  return candidate
}

// ─── Config lookup ───────────────────────────────────────

/**
 * Read `config('ai').eval.pattern` from the booted app. Returns
 * `null` (default pattern) when `@rudderjs/core` isn't loadable
 * or the app didn't boot — the CLI must still work in
 * introspective mode (#349).
 */
async function loadConfigPattern(): Promise<string | null> {
  try {
    // Dynamic import so the static graph doesn't pin `@rudderjs/core`
    // (optional peer). Falls back to default when core isn't loadable
    // or the app didn't boot.
    const core = await import('@rudderjs/core') as { config?: <T = unknown>(key: string) => T }
    if (typeof core.config !== 'function') return null
    const cfg = core.config<{ eval?: { pattern?: string } } | undefined>('ai')
    return cfg?.eval?.pattern ?? null
  } catch {
    return null
  }
}
