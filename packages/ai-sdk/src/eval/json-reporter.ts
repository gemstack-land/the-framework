import type { SuiteReport } from './index.js'

/**
 * Single case row in the JSON output. `metric.pass`/`metric.score`/
 * `metric.reason` are flattened up so consumers don't have to reach
 * through nested objects in CI scripts.
 */
export interface SuiteJsonCase {
  name:      string
  status:    'passed' | 'failed' | 'skipped'
  pass:      boolean
  score?:    number
  reason?:   string
  duration:  number
  tokens:    number
  cost:      number
}

/**
 * Machine-readable suite output emitted by `pnpm rudder ai:eval --json`.
 * Stable shape — bumping fields here is a minor (additive) bump for
 * `@gemstack/ai-sdk`. Removing or renaming fields is a major.
 */
export interface SuiteJson {
  suite:    string
  passed:   number
  failed:   number
  skipped:  number
  duration: number
  cost:     number
  tokens:   number
  cases:    SuiteJsonCase[]
}

/**
 * JSON reporter — flattens a `SuiteReport` for CI consumption.
 *
 * Mirrors the `command_run` MCP tool envelope shape so the boost
 * agent surface and the eval CLI feel like one family.
 *
 * @example
 *   const report = await runSuite(suite)
 *   process.stdout.write(JSON.stringify(reportJson(report)))
 */
export function reportJson(report: SuiteReport): SuiteJson {
  return {
    suite:    report.suite,
    passed:   report.passed,
    failed:   report.failed,
    skipped:  report.skipped,
    duration: report.duration,
    cost:     report.cost,
    tokens:   report.tokens,
    cases:    report.cases.map(toJsonCase),
  }
}

function toJsonCase(c: SuiteReport['cases'][number]): SuiteJsonCase {
  const out: SuiteJsonCase = {
    name:     c.name,
    status:   c.status,
    pass:     c.status === 'passed',
    duration: c.duration,
    tokens:   c.tokens,
    cost:     c.cost,
  }
  if (c.metric?.score !== undefined) out.score = c.metric.score
  if (c.status === 'skipped' && c.reason) out.reason = c.reason
  else if (c.metric?.reason) out.reason = c.metric.reason
  return out
}
