import type { Driver } from './driver/index.js'
import { META_SELECT_SYSTEM, metaSelect, type MetaSelection, type PresetCatalogEntry } from './meta-select.js'

/**
 * A benchmark for the AI meta-select step (#204/#502): does auto-picking the domain
 * preset actually route to the policy a human would pick? Rom's doubt on #485 is that a
 * generic "pick the build policy" instruction boxes the model without a clear goal — so
 * before we keep it, measure it rather than assume. This harness runs {@link metaSelect}
 * over a labeled corpus and scores the routing: overall accuracy, how often it *over-fires*
 * (picks a preset when the plain flow was right), and how often it *misses* (falls back to
 * the plain flow when a preset fit). Those three numbers are the decision input for #502.
 *
 * The scoring ({@link scoreMetaSelectBench}) is pure and unit-tested; the live run
 * ({@link runMetaSelectBench}) drives a real model through the given {@link Driver}. The
 * corpus ({@link META_SELECT_BENCH_CASES}) is deliberately small and hand-labeled — each
 * case carries a `why` so a human can challenge the label, since the "none" cases are
 * exactly the contested zone Rom is pointing at.
 */

/** `'none'` = the plain framework flow is the right answer (no domain preset fits). */
export const NONE = 'none'

/** One labeled routing case: an intent + a one-line workspace summary, and the expected pick. */
export interface MetaSelectBenchCase {
  /** The user's request, as they would type it to `framework`. */
  intent: string
  /** A one-line summary of the workspace, as the CLI passes to {@link metaSelect}. */
  workspace: string
  /** The preset name a human would pick, or {@link NONE} for the plain flow. */
  expected: string
  /**
   * Other picks that are also defensible for a genuinely cross-domain case (e.g. a chart of
   * a model's output is arguably web *or* data-science). A pick in here counts as correct,
   * so the harness tests "did it pick a defensible policy", not "did it match my one guess".
   * Leave empty for the strict cases — the vague and trap-`none` cases have no alternate,
   * so an off-target pick there is exactly the over-fire / misroute we want to catch.
   */
  alsoAcceptable?: readonly string[]
  /** Why that label — so a reviewer can contest it (the `none` calls especially). */
  why: string
}

/** True when `picked` is the case's expected label or one of its accepted alternates. */
export function isAcceptablePick(benchCase: MetaSelectBenchCase, picked: string): boolean {
  return picked === benchCase.expected || (benchCase.alsoAcceptable?.includes(picked) ?? false)
}

/** The outcome of running one case through {@link metaSelect}. */
export interface MetaSelectBenchResult {
  case: MetaSelectBenchCase
  selection: MetaSelection
  /** What the router picked, normalized to a name or {@link NONE}. */
  picked: string
  correct: boolean
}

/** Aggregate metrics over a set of {@link MetaSelectBenchResult}s — the #502 decision input. */
export interface MetaSelectBenchReport {
  total: number
  correct: number
  /** correct / total, in [0, 1]. */
  accuracy: number
  /** Expected {@link NONE} but a preset was picked: the "generic step boxes the AI" failure. */
  overFire: { count: number; of: number }
  /** Expected a preset but {@link NONE} was picked: a fit the router failed to catch. */
  miss: { count: number; of: number }
  /** Expected preset A, picked preset B (both real): routed to the wrong policy. */
  misroute: number
  /** Per expected-preset tally (includes {@link NONE}). */
  perExpected: Record<string, { total: number; correct: number }>
  results: MetaSelectBenchResult[]
}

/** Normalize a {@link MetaSelection} to the picked name, or {@link NONE} when no preset fit. */
export function pickedName(selection: MetaSelection): string {
  return selection.preset ?? NONE
}

/**
 * Score a set of already-run cases. Pure: no model, no IO — so the metrics are testable
 * and the same function scores a live run or a replayed one.
 */
export function scoreMetaSelectBench(results: readonly MetaSelectBenchResult[]): MetaSelectBenchReport {
  const perExpected: Record<string, { total: number; correct: number }> = {}
  let correct = 0
  let overFire = 0
  let overFireOf = 0
  let miss = 0
  let missOf = 0
  let misroute = 0
  for (const r of results) {
    const exp = r.case.expected
    const bucket = (perExpected[exp] ??= { total: 0, correct: 0 })
    bucket.total++
    if (r.correct) {
      correct++
      bucket.correct++
    }
    if (exp === NONE) {
      overFireOf++
      if (r.picked !== NONE) overFire++
    } else {
      missOf++
      if (r.picked === NONE) miss++
      else if (!isAcceptablePick(r.case, r.picked)) misroute++ // an accepted alternate is not a misroute
    }
  }
  const total = results.length
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    overFire: { count: overFire, of: overFireOf },
    miss: { count: miss, of: missOf },
    misroute,
    perExpected,
    results: [...results],
  }
}

/** Options for {@link runMetaSelectBench}. */
export interface RunMetaSelectBenchOptions {
  driver: Driver
  cases: readonly MetaSelectBenchCase[]
  catalog: readonly PresetCatalogEntry[]
  /** Where the driver runs its (throwaway) classification turn. Content is irrelevant. */
  cwd: string
  /** Model override passed to the driver. */
  model?: string
  signal?: AbortSignal
  /** Called after each case, so a runner can stream progress. */
  onResult?: (result: MetaSelectBenchResult, index: number) => void
}

/**
 * Run every case through {@link metaSelect} and score the routing. One short-lived session
 * per case (framed with {@link META_SELECT_SYSTEM}, like the CLI), disposed after — a case
 * must not see the previous one's context. Sequential on purpose: a classification turn is
 * cheap, and serial keeps the run gentle on rate limits and its output stable.
 */
export async function runMetaSelectBench(opts: RunMetaSelectBenchOptions): Promise<MetaSelectBenchReport> {
  const results: MetaSelectBenchResult[] = []
  for (const [index, benchCase] of opts.cases.entries()) {
    if (opts.signal?.aborted) break
    const session = await opts.driver.start({
      cwd: opts.cwd,
      system: META_SELECT_SYSTEM,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    try {
      const selection = await metaSelect(session, {
        intent: benchCase.intent,
        catalog: opts.catalog,
        workspace: benchCase.workspace,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })
      const picked = pickedName(selection)
      const result: MetaSelectBenchResult = { case: benchCase, selection, picked, correct: isAcceptablePick(benchCase, picked) }
      results.push(result)
      opts.onResult?.(result, index)
    } finally {
      await session.dispose()
    }
  }
  return scoreMetaSelectBench(results)
}

/** Render a {@link MetaSelectBenchReport} as a compact human-readable summary. */
export function formatMetaSelectBenchReport(report: MetaSelectBenchReport): string {
  const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`)
  const lines: string[] = []
  lines.push(`meta-select routing: ${report.correct}/${report.total} correct (${pct(report.correct, report.total)})`)
  lines.push(`  over-fire (picked a preset when 'none' was right): ${report.overFire.count}/${report.overFire.of}`)
  lines.push(`  miss (fell back to 'none' when a preset fit):       ${report.miss.count}/${report.miss.of}`)
  lines.push(`  misroute (picked the wrong preset):                 ${report.misroute}`)
  lines.push('  by expected:')
  for (const [name, { total, correct }] of Object.entries(report.perExpected)) {
    lines.push(`    ${name.padEnd(20)} ${correct}/${total} (${pct(correct, total)})`)
  }
  lines.push('  misses & misroutes:')
  const wrong = report.results.filter(r => !r.correct)
  if (wrong.length === 0) lines.push('    (none)')
  for (const r of wrong) {
    lines.push(`    [${r.case.expected} -> ${r.picked}] ${r.case.intent}`)
  }
  // Correct picks that took a defensible alternate rather than the primary label: not a
  // failure, but worth seeing on the cross-domain cases where the router had a real choice.
  const alternates = report.results.filter(r => r.correct && r.picked !== r.case.expected)
  if (alternates.length) {
    lines.push('  defensible alternates taken:')
    for (const r of alternates) {
      lines.push(`    [${r.case.expected} ~ ${r.picked}] ${r.case.intent}`)
    }
  }
  return lines.join('\n')
}

/**
 * The labeled corpus. Two bands:
 *
 * 1. Clear-cut cases: one intent that obviously maps to one preset (or obviously to
 *    `none`). These check the router does the easy thing.
 * 2. Adversarial cases (#502 follow-up): the ones that actually stress Rom's doubt —
 *    *vague / unclear-goal* intents where `none` is the honest answer (this is where
 *    over-fire shows), *trap `none`* intents dressed in domain keywords, genuinely
 *    *cross-domain* intents (scored with {@link MetaSelectBenchCase.alsoAcceptable}), and
 *    *mismatched* intent-vs-workspace signals.
 *
 * Labels are defensible, not gospel — the `why` is there to be argued with. Grow it as
 * real runs surface routing the model gets wrong.
 */
export const META_SELECT_BENCH_CASES: readonly MetaSelectBenchCase[] = [
  // web-development
  {
    intent: 'Add a dark-mode toggle to the site header',
    workspace: 'a Vike + React web app',
    expected: 'web-development',
    why: 'browser UI change — accessibility / perf / web-security review is the fitting loop',
  },
  {
    intent: "Fix the signup form so it is fully keyboard accessible",
    workspace: 'a Next.js app (App Router)',
    expected: 'web-development',
    why: 'an a11y fix on rendered markup, the web-development loop owns a11y',
  },
  {
    intent: 'Add OpenGraph and Twitter meta tags to every route',
    workspace: 'an Astro content site',
    expected: 'web-development',
    why: 'per-route markup on a browser app',
  },
  // data-science
  {
    intent: 'Add k-fold cross-validation to the churn model training script',
    workspace: 'a Python ML repo with notebooks',
    expected: 'data-science',
    why: 'model training methodology — reproducibility / method review',
  },
  {
    intent: 'The feature pipeline silently drops rows; make it validate its inputs',
    workspace: 'a pandas ETL project',
    expected: 'data-science',
    why: 'a data pipeline correctness change — data validation is the point',
  },
  // biological-science
  {
    intent: 'Add the missing controls to the RNA-seq differential-expression analysis',
    workspace: 'a bioinformatics pipeline (Snakemake + R)',
    expected: 'biological-science',
    why: 'experimental design / controls in a life-science analysis',
  },
  {
    intent: 'Recompute the p-values with Benjamini-Hochberg multiple-testing correction',
    workspace: 'a genomics analysis repo',
    expected: 'biological-science',
    why: 'statistical rigor on a biological dataset',
  },
  // product-management
  {
    intent: 'Draft the acceptance criteria and success metrics for the referral feature',
    workspace: 'a product spec repo (markdown docs only)',
    expected: 'product-management',
    why: 'requirement + measurable-outcome work, no stack concern',
  },
  {
    intent: 'Write the PRD for the onboarding revamp and define how we measure it',
    workspace: 'a docs-only planning repo',
    expected: 'product-management',
    why: 'a product outcome drives it, not code',
  },
  // software-development
  {
    intent: 'Refactor the payment service to remove the duplicated retry logic',
    workspace: 'a Go microservices monorepo',
    expected: 'software-development',
    why: 'stack-agnostic engineering hygiene — review / tests / security',
  },
  {
    intent: 'Add unit tests and fix the data race in the job queue',
    workspace: 'a Rust backend service',
    expected: 'software-development',
    why: 'general engineering: tests + a concurrency correctness fix, no web/data/PM angle',
  },
  // none — the contested band Rom is pointing at
  {
    intent: 'What is the difference between a left join and an inner join?',
    workspace: 'an empty directory',
    expected: NONE,
    why: 'a question, not a build task — no review loop applies',
  },
  {
    intent: 'Update the copyright year in the LICENSE file to 2026',
    workspace: 'a small TypeScript utility library',
    expected: NONE,
    why: 'a trivial text edit; a full domain review loop adds nothing here',
  },

  // --- adversarial band (#502): the cases that actually test the doubt ---

  // vague / unclear-goal: no actionable goal, so 'none' (plain flow) is right. A preset
  // pick here is over-fire — the exact "generic step boxes the AI" failure Rom flagged.
  {
    intent: 'clean this up',
    workspace: 'a mixed TypeScript repo',
    expected: NONE,
    why: 'no concrete goal or scope; there is nothing for a domain loop to key on',
  },
  {
    intent: 'make it better',
    workspace: 'a small web project',
    expected: NONE,
    why: 'no stated objective — a preset would be guessing at intent',
  },
  {
    intent: 'can you take a look',
    workspace: 'a backend service',
    expected: NONE,
    why: 'an open-ended ask with no task; the plain flow should handle it',
  },

  // trap 'none': trivial work wearing domain keywords. The keyword must not pull a preset.
  {
    intent: "Bump the version in the bioinformatics pipeline's README to 2.0",
    workspace: 'a Snakemake genomics repo',
    expected: NONE,
    why: 'a one-line doc edit; "bioinformatics/genomics" should not trigger biological-science',
  },
  {
    intent: "Fix the typo in the data pipeline's log message",
    workspace: 'a pandas ETL project',
    expected: NONE,
    why: 'a cosmetic string fix; "data pipeline" should not trigger data-science',
  },

  // genuinely cross-domain: two defensible policies. Scored with alsoAcceptable, so the
  // test is "did it pick a defensible one", not "did it match my single guess".
  {
    intent: "Add an accessible bar chart of the churn model's predictions to the dashboard",
    workspace: 'a Next.js app that reads a trained model',
    expected: 'web-development',
    alsoAcceptable: ['data-science'],
    why: 'the concrete change is accessible UI (web), but it visualizes a model (data) — either is fair',
  },
  {
    intent: 'Add input validation and helpful error messages to the CSV upload form',
    workspace: 'a Vike app with a data-import feature',
    expected: 'web-development',
    alsoAcceptable: ['data-science'],
    why: 'form UX is a web concern; validating incoming data is a data concern',
  },
  {
    intent: 'Write tests for the statistics module and fix the off-by-one in the p-value calc',
    workspace: 'a genomics analysis repo',
    expected: 'biological-science',
    alsoAcceptable: ['software-development', 'data-science'],
    why: 'statistical correctness in a bio context, but also plain tests + a bug fix',
  },
  {
    intent: 'Define success metrics and add the analytics events to track signups',
    workspace: 'a Next.js SaaS app',
    expected: 'product-management',
    alsoAcceptable: ['web-development'],
    why: 'success metrics are a product concern; wiring the events is a web change',
  },

  // mismatched signals: a strong intent against a contradictory workspace line. Intent wins.
  {
    intent: 'Add k-fold cross-validation to the model training script',
    workspace: 'a product management docs repo',
    expected: 'data-science',
    why: 'the intent is unmistakably data-science; the workspace label should not override it',
  },
]
