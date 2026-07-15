import { DecisionLedger, type ArchitectPlan } from '@gemstack/ai-autopilot'
import type { Driver } from './driver/index.js'
import { driverArchitect } from './steps.js'

/**
 * A benchmark for the architect prompt (`architectPrompt` in `steps.ts`) — the turn that
 * decides an app's stack. Rom's line on #485: the system prompt is the most critical part
 * of The Framework, and #499 already had to strip a Vike nudge from this one because a
 * biased stack pick erodes trust. So measure it
 * rather than assume: does the architect pick a *sane* stack for the app, does it give the
 * *honest tradeoffs* the prompt demands (pros AND cons AND a rejected alternative), and —
 * the trust check — on genuinely framework-agnostic web apps, is it *balanced* across
 * frameworks rather than defaulting to Vike?
 *
 * Scoring ({@link scoreArchitectBench}) is pure and unit-tested; the live run
 * ({@link runArchitectBench}) drives a real model through the given {@link Driver}. The
 * corpus ({@link ARCHITECT_BENCH_CASES}) is hand-labeled — each case says which stacks are
 * sane (`accept`) and, where a whole category would be wrong, which are not (`reject`).
 */

/** One labeled architect case. */
export interface ArchitectBenchCase {
  /** The app the user asks for. */
  intent: string
  /** The picked stack fits if it matches at least one of these. */
  accept: readonly RegExp[]
  /** ...and matches none of these (a category that is clearly wrong for this app). */
  reject?: readonly RegExp[]
  /**
   * A web app where any modern framework is a fine choice. These do not test stack-fit
   * (they always fit); they feed the framework-balance tally — the #499 trust check.
   */
  webAgnostic?: boolean
  /** Why these labels — so a reviewer can contest them. */
  why: string
}

/** The outcome of running one case through the architect. */
export interface ArchitectBenchResult {
  case: ArchitectBenchCase
  plan: ArchitectPlan
  /** The picked stack, verbatim. */
  stack: string
  /** The stack matched an `accept` pattern and no `reject` pattern. */
  stackFit: boolean
  /** The plan carried at least one pro, one con, and one rejected alternative. */
  complete: boolean
  /** The frontend framework detected in the stack, or `'other'`. Used for the balance tally. */
  framework: string
}

/** Aggregate metrics over a set of {@link ArchitectBenchResult}s — the decision input. */
export interface ArchitectBenchReport {
  total: number
  /** Cases whose picked stack was sane for the app (excludes web-agnostic cases). */
  stackFit: { count: number; of: number }
  /** Cases whose plan gave the full honest tradeoff (pros + cons + a rejected alternative). */
  complete: { count: number; of: number }
  /**
   * Framework distribution across the web-agnostic cases (the trust check): a heavy skew to
   * one framework is the bias #499 was worried about. `{}` when there are no such cases.
   */
  frameworkBalance: Record<string, number>
  results: ArchitectBenchResult[]
}

/** Known frontend frameworks, most specific first, for the balance tally. */
const FRAMEWORKS: readonly { name: string; re: RegExp }[] = [
  { name: 'sveltekit', re: /\bsveltekit\b/i },
  { name: 'next', re: /\bnext(\.js)?\b/i },
  { name: 'nuxt', re: /\bnuxt\b/i },
  { name: 'remix', re: /\bremix\b/i },
  { name: 'astro', re: /\bastro\b/i },
  { name: 'vike', re: /\bvike\b/i },
  { name: 'solidstart', re: /\bsolid(start)?\b/i },
  { name: 'react', re: /\breact\b/i },
  { name: 'vue', re: /\bvue\b/i },
  { name: 'svelte', re: /\bsvelte\b/i },
]

/** The frontend framework named in a stack string, or `'other'` if none is recognized. */
export function detectFramework(stack: string): string {
  return FRAMEWORKS.find(f => f.re.test(stack))?.name ?? 'other'
}

/** Whether a plan carries the full honest tradeoff the architect prompt asks for. */
export function isComplete(plan: ArchitectPlan): boolean {
  return (plan.pros?.length ?? 0) > 0 && (plan.cons?.length ?? 0) > 0 && (plan.alternatives?.length ?? 0) > 0
}

/** Whether a picked stack is sane for the case: matches an accept and no reject. */
export function isStackFit(benchCase: ArchitectBenchCase, stack: string): boolean {
  const accepted = benchCase.accept.some(re => re.test(stack))
  const rejected = benchCase.reject?.some(re => re.test(stack)) ?? false
  return accepted && !rejected
}

/**
 * Score already-run cases. Pure: no model, no IO. Web-agnostic cases are excluded from the
 * stack-fit rate (they always fit) and instead feed the framework-balance tally.
 */
export function scoreArchitectBench(results: readonly ArchitectBenchResult[]): ArchitectBenchReport {
  let fit = 0
  let fitOf = 0
  let complete = 0
  const frameworkBalance: Record<string, number> = {}
  for (const r of results) {
    if (r.complete) complete++
    if (r.case.webAgnostic) {
      frameworkBalance[r.framework] = (frameworkBalance[r.framework] ?? 0) + 1
    } else {
      fitOf++
      if (r.stackFit) fit++
    }
  }
  return {
    total: results.length,
    stackFit: { count: fit, of: fitOf },
    complete: { count: complete, of: results.length },
    frameworkBalance,
    results: [...results],
  }
}

/** Options for {@link runArchitectBench}. */
export interface RunArchitectBenchOptions {
  driver: Driver
  cases: readonly ArchitectBenchCase[]
  /** Where the driver runs the (throwaway) architect turn. */
  cwd: string
  model?: string
  signal?: AbortSignal
  onResult?: (result: ArchitectBenchResult, index: number) => void
}

/**
 * Run every case through {@link driverArchitect} and score it. One short-lived session per
 * case, disposed after. No system prompt is injected: the architect prompt is self-contained,
 * so this measures that prompt itself (the thing #499 changed), not the #326 framing around
 * it. Sequential — an architect turn is not cheap and serial keeps the run stable.
 */
export async function runArchitectBench(opts: RunArchitectBenchOptions): Promise<ArchitectBenchReport> {
  const results: ArchitectBenchResult[] = []
  for (const [index, benchCase] of opts.cases.entries()) {
    if (opts.signal?.aborted) break
    const session = await opts.driver.start({
      cwd: opts.cwd,
      system: '',
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    try {
      const architect = driverArchitect(session, {})
      // driverArchitect only reads ctx.intent; scope + ledger satisfy the contract with a
      // fresh (empty) ledger so no prior decision steers the pick.
      const plan = await architect({ intent: benchCase.intent, scope: 'full', ledger: new DecisionLedger() })
      const stack = plan.stack ?? ''
      const result: ArchitectBenchResult = {
        case: benchCase,
        plan,
        stack,
        stackFit: isStackFit(benchCase, stack),
        complete: isComplete(plan),
        framework: detectFramework(stack),
      }
      results.push(result)
      opts.onResult?.(result, index)
    } finally {
      await session.dispose()
    }
  }
  return scoreArchitectBench(results)
}

/** Render an {@link ArchitectBenchReport} as a compact human-readable summary. */
export function formatArchitectBenchReport(report: ArchitectBenchReport): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`)
  const lines: string[] = []
  lines.push(`architect: ${report.stackFit.count}/${report.stackFit.of} sane stacks (${pct(report.stackFit.count, report.stackFit.of)})`)
  lines.push(`  honest tradeoffs (pros + cons + a rejected alternative): ${report.complete.count}/${report.complete.of} (${pct(report.complete.count, report.complete.of)})`)
  const balance = Object.entries(report.frameworkBalance).sort((a, b) => b[1] - a[1])
  if (balance.length) {
    lines.push(`  framework balance on agnostic web apps (${balance.reduce((n, [, c]) => n + c, 0)} cases):`)
    for (const [name, count] of balance) lines.push(`    ${name.padEnd(12)} ${count}`)
  }
  const unfit = report.results.filter(r => !r.case.webAgnostic && !r.stackFit)
  const incomplete = report.results.filter(r => !r.complete)
  if (unfit.length) {
    lines.push('  questionable stacks:')
    for (const r of unfit) lines.push(`    [${r.stack}] ${r.case.intent}`)
  }
  if (incomplete.length) {
    lines.push('  missing tradeoffs:')
    for (const r of incomplete) lines.push(`    ${r.case.intent}`)
  }
  return lines.join('\n')
}

const WEB = /\b(next(\.js)?|vike|nuxt|sveltekit|remix|astro|react|vue|svelte|solid(start)?|angular)\b/i
const SERVER = /\b(express|fastify|hono|nest(js)?|koa|adonis|node(\.js)?|django|flask|fastapi|rails|laravel|go\b|gin|rust|axum|spring)\b/i

/**
 * The labeled corpus. Two kinds:
 * - **category cases** — an app whose *type* dictates the stack family (a CLI is not a web
 *   app; a mobile app is not Next.js). These test stack-fit with `accept` + `reject`.
 * - **web-agnostic cases** — plain web apps where any modern framework is fine. They feed
 *   the framework-balance tally, the trust check that #499 was about.
 * Labels are defensible, not gospel — the `why` is there to argue with.
 */
export const ARCHITECT_BENCH_CASES: readonly ArchitectBenchCase[] = [
  {
    intent: 'A command-line tool that bulk-renames files with a --dry-run flag',
    accept: [/\b(node(\.js)?|deno|bun|typescript|go\b|rust|python)\b/i],
    reject: [WEB],
    why: 'a CLI needs a runtime, not a web framework',
  },
  {
    intent: 'A JSON REST API for a todo list backed by Postgres, no frontend',
    accept: [SERVER],
    reject: [/\bastro\b|\bhugo\b|\beleventy\b|\bgatsby\b|create-react-app|vite \+ react/i],
    why: 'a headless API wants a server framework, not a static-site generator or a SPA',
  },
  {
    intent: 'A cross-platform mobile app to track workouts offline',
    accept: [/\b(react native|expo|flutter|ionic|capacitor|kotlin multiplatform)\b/i],
    // Reject a *web frontend* framework used as the app shell (it would not be native), but
    // not a server framework — a mobile app may legitimately have a backend.
    reject: [/\b(next(\.js)?|vike|nuxt|astro|remix|sveltekit)\b/i],
    why: 'a native mobile app needs a mobile framework, not a web frontend',
  },
  {
    intent: 'A desktop note-taking app with local file storage and a system tray',
    // Accept requires a desktop shell; that alone is the test. No reject on web frameworks:
    // Tauri / Electron legitimately embed a web frontend (React/Vike/etc.) inside the shell.
    accept: [/\b(electron|tauri|neutralino|wails|\.net maui|qt)\b/i],
    why: 'a desktop app wants a desktop shell (which may embed a web UI)',
  },
  {
    intent: 'A nightly Python job that scrapes prices and writes a CSV report',
    accept: [/\b(python|node(\.js)?|typescript|go\b)\b/i],
    reject: [WEB],
    why: 'a batch script needs a runtime, not a UI framework',
  },
  {
    intent: 'A documentation site generated from markdown files',
    accept: [/\b(astro|vike|next(\.js)?|nuxt|vitepress|docusaurus|eleventy|hugo|starlight|sveltekit)\b/i],
    why: 'a docs site wants a static-site / content meta-framework — many are fine',
  },
  // web-agnostic: any modern framework is a fine pick — these feed the balance tally.
  {
    intent: 'A web app to manage a personal book library with search',
    accept: [WEB],
    webAgnostic: true,
    why: 'a straightforward CRUD web app; no framework is uniquely right',
  },
  {
    intent: 'A realtime team chat web app with channels and presence',
    accept: [WEB],
    webAgnostic: true,
    why: 'realtime web app; several frameworks handle it well',
  },
  {
    intent: 'A web dashboard showing charts of sales data with filters',
    accept: [WEB],
    webAgnostic: true,
    why: 'a data dashboard web app; framework choice is open',
  },
  {
    intent: 'A small marketing website with a contact form',
    accept: [WEB],
    webAgnostic: true,
    why: 'a content site; many frameworks fit',
  },
  {
    intent: 'A web-based kanban board with drag-and-drop cards',
    accept: [WEB],
    webAgnostic: true,
    why: 'an interactive web app; framework-agnostic',
  },
  {
    intent: 'An online storefront with a product catalog and cart',
    accept: [WEB],
    webAgnostic: true,
    why: 'an e-commerce web app; several stacks are reasonable',
  },
]
