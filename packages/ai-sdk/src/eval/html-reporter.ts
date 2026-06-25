/**
 * Self-contained HTML reporter for `pnpm rudder ai:eval --html`
 * (#A5 Phase 5). Renders one or more {@link SuiteReport}s into a
 * single HTML string with inline styles and minimal vanilla JS for
 * row expand/collapse — no framework deps, no external assets, safe
 * to paste into a PR comment or open offline.
 *
 * Defensive HTML-escape on every piece of user content (suite name,
 * case name, input, response, metadata). Long responses get a
 * `<pre>` block with `white-space: pre-wrap` so output stays
 * scannable without a horizontal scroll.
 */

import type { SuiteReport, EvalMetadata } from './index.js'

export interface HtmlReportOptions {
  /** Document `<title>`. Defaults to `"Eval Report"`. */
  title?:       string
  /** ISO timestamp shown in the header. Defaults to `new Date().toISOString()`. */
  generatedAt?: string
}

/**
 * Render an array of {@link SuiteReport}s as a single self-contained
 * HTML document.
 */
export function reportHtml(reports: SuiteReport[], opts: HtmlReportOptions = {}): string {
  const title       = opts.title ?? 'Eval Report'
  const generatedAt = opts.generatedAt ?? new Date().toISOString()

  const totals = reports.reduce(
    (a, r) => ({
      cases:    a.cases    + r.cases.length,
      passed:   a.passed   + r.passed,
      failed:   a.failed   + r.failed,
      skipped:  a.skipped  + r.skipped,
      cost:     a.cost     + r.cost,
      tokens:   a.tokens   + r.tokens,
      duration: a.duration + r.duration,
    }),
    { cases: 0, passed: 0, failed: 0, skipped: 0, cost: 0, tokens: 0, duration: 0 },
  )

  const passRate = totals.cases > 0 ? Math.round((totals.passed / totals.cases) * 100) : 0

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="page-header">
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    Generated ${escapeHtml(generatedAt)} ·
    ${reports.length} suite${plural(reports.length)} ·
    ${totals.cases} case${plural(totals.cases)} ·
    <strong class="${passRate === 100 ? 'ok' : passRate >= 80 ? 'warn' : 'bad'}">${passRate}% pass</strong> ·
    ${formatCost(totals.cost)} ·
    ${totals.tokens.toLocaleString()} tokens ·
    ${formatMs(totals.duration)}
  </div>
</header>
${reports.map(renderSuite).join('\n')}
<script>${SCRIPT}</script>
</body>
</html>
`
}

function renderSuite(r: SuiteReport): string {
  const passRate = r.cases.length > 0 ? Math.round((r.passed / r.cases.length) * 100) : 0
  return `<section class="suite">
  <header class="suite-header">
    <h2>${escapeHtml(r.suite)}</h2>
    <div class="suite-stats">
      <span class="${passRate === 100 ? 'ok' : passRate >= 80 ? 'warn' : 'bad'}">${r.passed}/${r.cases.length} passed</span>
      ${r.skipped > 0 ? `· <span class="muted">${r.skipped} skipped</span>` : ''}
      · ${formatCost(r.cost)}
      · ${r.tokens.toLocaleString()} tokens
      · ${formatMs(r.duration)}
    </div>
    ${renderMetadata(r.metadata)}
  </header>
  <table class="cases">
    <thead>
      <tr>
        <th>Case</th>
        <th>Status</th>
        <th class="num">Tokens</th>
        <th class="num">Cost</th>
        <th class="num">Duration</th>
      </tr>
    </thead>
    <tbody>
${r.cases.map(renderCase).join('\n')}
    </tbody>
  </table>
</section>`
}

function renderCase(c: SuiteReport['cases'][number]): string {
  const glyph = c.status === 'passed' ? '✓' : c.status === 'failed' ? '✗' : '○'
  const responseBlock = c.responseText !== undefined
    ? `<h4>Response</h4><pre>${escapeHtml(c.responseText)}</pre>`
    : '<h4>Response</h4><pre class="muted">&lt;no response — agent threw or skipped&gt;</pre>'
  const reasonBlock = (c.metric?.reason ?? c.reason)
    ? `<h4>Reason</h4><pre>${escapeHtml(c.metric?.reason ?? c.reason!)}</pre>`
    : ''
  const scoreBlock = c.metric?.score !== undefined
    ? `<h4>Score</h4><pre>${c.metric.score.toFixed(3)}</pre>`
    : ''
  return `      <tr class="case ${c.status}" tabindex="0" aria-expanded="false">
        <td><span class="glyph">${glyph}</span> ${escapeHtml(c.name)}</td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td class="num">${c.tokens.toLocaleString()}</td>
        <td class="num">${formatCost(c.cost)}</td>
        <td class="num">${formatMs(c.duration)}</td>
      </tr>
      <tr class="case-detail" hidden>
        <td colspan="5">
          <h4>Input</h4>
          <pre>${escapeHtml(c.input)}</pre>
          ${responseBlock}
          ${scoreBlock}
          ${reasonBlock}
        </td>
      </tr>`
}

function renderMetadata(meta: EvalMetadata | undefined): string {
  if (!meta) return ''
  const rows = Object.entries(meta).filter(([, v]) => v !== undefined && v !== '')
  if (rows.length === 0) return ''
  return `<dl class="metadata">${
    rows.map(([k, v]) => `<dt>${escapeHtml(formatLabel(k))}</dt><dd>${escapeHtml(v!)}</dd>`).join('')
  }</dl>`
}

function formatLabel(key: string): string {
  // camelCase → Title Case for the well-known keys; pass others through.
  if (key === 'lastReviewed') return 'Last reviewed'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

// ─── HTML escape (no external dep) ───────────────────────

const ESCAPE_MAP: Record<string, string> = {
  '&':  '&amp;',
  '<':  '&lt;',
  '>':  '&gt;',
  '"':  '&quot;',
  "'":  '&#39;',
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]!)
}

function plural(n: number): string {
  return n === 1 ? '' : 's'
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(usd: number): string {
  if (usd === 0)     return '$0.000'
  if (usd < 0.001)   return '<$0.001'
  return `$${usd.toFixed(3)}`
}

// ─── Inline assets ────────────────────────────────────────

const STYLE = `
:root { color-scheme: light dark; --fg: #1a1a1a; --bg: #fff; --muted: #6a6a6a; --border: #e2e2e2; --row-hover: #f7f7f7; --ok: #1a7f37; --warn: #b08800; --bad: #b91c1c; --pre-bg: #f6f8fa; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6e6; --bg: #0d1117; --muted: #8a8a8a; --border: #30363d; --row-hover: #161b22; --ok: #3fb950; --warn: #d29922; --bad: #f85149; --pre-bg: #161b22; }
}
* { box-sizing: border-box }
body { font: 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 24px; max-width: 1100px; margin-inline: auto }
h1 { margin: 0 0 4px; font-size: 24px }
h2 { margin: 0 0 4px; font-size: 18px }
h4 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted) }
pre { background: var(--pre-bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; font: 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; margin: 0 }
.page-header { border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 20px }
.page-header .meta { color: var(--muted); font-size: 13px }
.suite { margin-bottom: 28px }
.suite-header h2 { display: inline }
.suite-stats { color: var(--muted); font-size: 13px; margin-top: 4px }
.metadata { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 8px 0 0; font-size: 13px }
.metadata dt { color: var(--muted); font-weight: normal }
.metadata dd { margin: 0 }
.cases { width: 100%; border-collapse: collapse; margin-top: 12px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden }
.cases th, .cases td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border) }
.cases th { background: var(--pre-bg); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted) }
.cases tr:last-child td { border-bottom: none }
.cases tr.case { cursor: pointer; user-select: none }
.cases tr.case:hover { background: var(--row-hover) }
.cases tr.case:focus { outline: 2px solid var(--warn); outline-offset: -2px }
.cases tr.case-detail td { background: var(--pre-bg) }
.cases td.num { text-align: right; font-variant-numeric: tabular-nums }
.glyph { display: inline-block; width: 14px; font-weight: bold }
.cases tr.case.passed .glyph { color: var(--ok) }
.cases tr.case.failed .glyph { color: var(--bad) }
.cases tr.case.skipped .glyph { color: var(--muted) }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em }
.badge.passed { background: rgba(63,185,80,.15); color: var(--ok) }
.badge.failed { background: rgba(248,81,73,.15); color: var(--bad) }
.badge.skipped { background: rgba(138,138,138,.15); color: var(--muted) }
.ok { color: var(--ok) } .warn { color: var(--warn) } .bad { color: var(--bad) } .muted { color: var(--muted) }
`.trim()

const SCRIPT = `
document.querySelectorAll('tr.case').forEach(function(row) {
  function toggle() {
    var detail = row.nextElementSibling;
    if (!detail || !detail.classList.contains('case-detail')) return;
    var open = !detail.hidden;
    detail.hidden = open;
    row.setAttribute('aria-expanded', String(!open));
  }
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
});
`.trim()
