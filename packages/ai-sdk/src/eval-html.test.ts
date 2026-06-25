/**
 * HTML reporter + suite metadata tests for #A5 Phase 5.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import {
  evalSuite,
  exactMatch,
  runSuite,
  reportHtml,
  type SuiteReport,
} from './eval/index.js'
import { runEvalCli } from './commands/ai-eval.js'

class StubAgent extends Agent {
  instructions() { return 'stub' }
}

// ─── reportHtml ──────────────────────────────────────────

describe('reportHtml', () => {
  it('renders suite + case names + stats', () => {
    const reports: SuiteReport[] = [
      {
        suite: 'SupportAgent',
        cases: [
          { name: 'reset',   status: 'passed', duration: 10, tokens: 50, cost: 0.001, input: 'reset?', responseText: 'go to /reset', metric: { pass: true, score: 1 } },
          { name: 'pricing', status: 'failed', duration: 20, tokens: 70, cost: 0.002, input: 'cost?', responseText: 'free!', metric: { pass: false, reason: 'expected $99' } },
        ],
        passed: 1, failed: 1, skipped: 0, duration: 30, cost: 0.003, tokens: 120,
      },
    ]
    const html = reportHtml(reports, { generatedAt: '2026-05-10T00:00:00Z' })
    assert.match(html, /<!DOCTYPE html>/)
    assert.match(html, /<title>Eval Report<\/title>/)
    assert.match(html, /SupportAgent/)
    assert.match(html, /reset/)
    assert.match(html, /go to \/reset/)
    assert.match(html, /pricing/)
    assert.match(html, /expected \$99/)
    assert.match(html, /50%\s*pass/)
  })

  it('HTML-escapes user content (response, input, names)', () => {
    const reports: SuiteReport[] = [
      {
        suite: '<script>alert(1)</script>',
        cases: [
          {
            name:         'xss & friends',
            status:       'failed',
            duration:     1,
            tokens:       0,
            cost:         0,
            input:        '<img src=x onerror=alert(1)>',
            responseText: 'a "quoted" \'string\' with <tags>',
            metric:       { pass: false, reason: '<bad>' },
          },
        ],
        passed: 0, failed: 1, skipped: 0, duration: 1, cost: 0, tokens: 0,
      },
    ]
    const html = reportHtml(reports)
    // No raw `<script>` from the suite name should leak into the document body.
    const bodyStart = html.indexOf('<body>')
    const body = html.slice(bodyStart)
    assert.ok(!body.includes('<script>alert(1)</script>'), 'suite-name <script> must be escaped')
    assert.ok(body.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'suite name should be escaped')
    assert.ok(!body.includes('<img src=x'),    'input <img> must be escaped')
    assert.match(body, /&quot;quoted&quot;/)
    assert.match(body, /&lt;tags&gt;/)
  })

  it('renders metadata block when present, omits it when not', () => {
    const withMeta: SuiteReport = {
      suite: 'A', cases: [], passed: 0, failed: 0, skipped: 0, duration: 0, cost: 0, tokens: 0,
      metadata: { owner: '@jane', lastReviewed: '2026-05-01', ticket: 'AI-42', custom: 'x' },
    }
    const withoutMeta: SuiteReport = {
      suite: 'B', cases: [], passed: 0, failed: 0, skipped: 0, duration: 0, cost: 0, tokens: 0,
    }
    const html = reportHtml([withMeta, withoutMeta])
    assert.match(html, /<dt>Owner<\/dt>\s*<dd>@jane<\/dd>/)
    assert.match(html, /<dt>Last reviewed<\/dt>/)
    assert.match(html, /<dt>Ticket<\/dt>\s*<dd>AI-42<\/dd>/)
    assert.match(html, /<dt>Custom<\/dt>\s*<dd>x<\/dd>/)
    // The without-meta suite section must not introduce a metadata <dl>.
    const sections = html.split('<section class="suite">')
    assert.equal(sections.length, 3)   // [pre, A, B]
    assert.ok(!sections[2]!.includes('<dl class="metadata">'),
      'second suite without metadata should have no <dl>')
  })

  it('renders &lt;no response&gt; when responseText is absent', () => {
    const reports: SuiteReport[] = [
      {
        suite: 'A',
        cases: [{ name: 'agent-threw', status: 'failed', duration: 1, tokens: 0, cost: 0, input: 'q', metric: { pass: false, reason: 'crash' } }],
        passed: 0, failed: 1, skipped: 0, duration: 1, cost: 0, tokens: 0,
      },
    ]
    const html = reportHtml(reports)
    assert.match(html, /&lt;no response — agent threw or skipped&gt;/)
  })

  it('includes the script + click handler on the row', () => {
    const html = reportHtml([{
      suite: 'S',
      cases: [{ name: 'c', status: 'passed', duration: 1, tokens: 0, cost: 0, input: 'i', responseText: 'o', metric: { pass: true, score: 1 } }],
      passed: 1, failed: 0, skipped: 0, duration: 1, cost: 0, tokens: 0,
    }])
    assert.match(html, /addEventListener\('click'/)
    assert.match(html, /aria-expanded="false"/)
  })

  it('handles empty reports list (all-skip / no-suites edge case)', () => {
    const html = reportHtml([])
    assert.match(html, /0 suites/)
    assert.match(html, /0 cases/)
    assert.match(html, /0%\s*pass/)
  })
})

// ─── Suite metadata thread-through ───────────────────────

describe('evalSuite metadata', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => fake.restore())

  it('preserves metadata on the frozen suite + on SuiteReport', async () => {
    fake.respondWith('hi')
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [{ input: 'x', assert: exactMatch('hi') }],
      metadata: { owner: '@jane', ticket: 'AI-1' },
    })
    assert.deepEqual(suite.spec.metadata, { owner: '@jane', ticket: 'AI-1' })
    const report = await runSuite(suite)
    assert.deepEqual(report.metadata, { owner: '@jane', ticket: 'AI-1' })
  })

  it('omits metadata field when not provided (back-compat)', async () => {
    fake.respondWith('hi')
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [{ input: 'x', assert: exactMatch('hi') }],
    })
    const report = await runSuite(suite)
    assert.equal('metadata' in report, false)
  })
})

// ─── CaseResult.input / responseText ─────────────────────

describe('CaseResult — input + responseText', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })
  afterEach(() => fake.restore())

  it('input is always populated, responseText is set on a successful run', async () => {
    fake.respondWith('the response')
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [{ input: 'the input', assert: exactMatch('the response') }],
    })
    const report = await runSuite(suite)
    assert.equal(report.cases[0]!.input, 'the input')
    assert.equal(report.cases[0]!.responseText, 'the response')
  })

  it('responseText is omitted on skipped cases (input still populated)', async () => {
    const suite = evalSuite('S', {
      agent: () => new StubAgent(),
      cases: [{ input: 'q', assert: exactMatch('a'), skip: true }],
    })
    const report = await runSuite(suite)
    assert.equal(report.cases[0]!.input, 'q')
    assert.equal(report.cases[0]!.responseText, undefined)
  })
})

// ─── CLI --html flag ─────────────────────────────────────

describe('runEvalCli — --html', () => {
  let fake: AiFake
  let tmp: string
  beforeEach(async () => {
    fake = AiFake.fake()
    tmp  = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-html-'))
  })
  afterEach(async () => {
    fake.restore()
    await rm(tmp, { recursive: true, force: true })
  })

  it('writes a self-contained HTML file at the given path', async () => {
    fake.respondWith('hi')
    const htmlPath = path.join(tmp, 'report.html')
    const code = await runEvalCli(
      { bail: false, json: false, html: htmlPath },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => evalSuite('Sample', {
          agent: () => new StubAgent(),
          cases: [{ name: 'first', input: 'x', assert: exactMatch('hi') }],
        }),
      },
    )
    assert.equal(code, 0)
    const contents = await readFile(htmlPath, 'utf8')
    assert.match(contents, /<title>Eval Report<\/title>/)
    assert.match(contents, /Sample/)
    assert.match(contents, /first/)
  })

  it('coexists with --json (HTML to file, JSON to stdout)', async () => {
    fake.respondWith('hi')
    const htmlPath = path.join(tmp, 'report.html')
    const stdout = capture()
    await runEvalCli(
      { bail: false, json: true, html: htmlPath },
      {
        cwd:           '/virtual',
        stdout,
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => evalSuite('Sample', {
          agent: () => new StubAgent(),
          cases: [{ name: 'first', input: 'x', assert: exactMatch('hi') }],
        }),
      },
    )
    // JSON envelope is on stdout
    const parsed = JSON.parse(stdout.read()) as { suites: unknown[] }
    assert.equal(parsed.suites.length, 1)
    // HTML file is on disk
    const html = await readFile(htmlPath, 'utf8')
    assert.match(html, /<title>Eval Report<\/title>/)
  })

  it('creates intermediate directories for the HTML path', async () => {
    fake.respondWith('hi')
    const nested = path.join(tmp, 'reports', '2026', 'eval.html')
    await runEvalCli(
      { bail: false, json: false, html: nested },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => evalSuite('Sample', {
          agent: () => new StubAgent(),
          cases: [{ input: 'x', assert: exactMatch('hi') }],
        }),
      },
    )
    const html = await readFile(nested, 'utf8')
    assert.match(html, /Sample/)
  })
})

// ─── parseArgs --html parsing ────────────────────────────

describe('parseArgs --html', () => {
  it('supports --html=value form', async () => {
    const { parseArgs } = await import('./commands/ai-eval.js')
    assert.equal(parseArgs(['--html=out.html']).html, 'out.html')
  })

  it('supports --html value form', async () => {
    const { parseArgs } = await import('./commands/ai-eval.js')
    assert.equal(parseArgs(['--html', 'out.html']).html, 'out.html')
  })

  it('throws when --html has no value', async () => {
    const { parseArgs } = await import('./commands/ai-eval.js')
    assert.throws(() => parseArgs(['--html']), /requires a value/)
  })

  it('does not consume positional name filter as the --html value', async () => {
    const { parseArgs } = await import('./commands/ai-eval.js')
    const o = parseArgs(['support', '--html=out.html'])
    assert.equal(o.filter, 'support')
    assert.equal(o.html,   'out.html')
  })
})

// ─── helpers ─────────────────────────────────────────────

interface CapturedStream { write(s: string): boolean; read(): string }
function capture(): CapturedStream {
  const chunks: string[] = []
  return {
    write(s) { chunks.push(s); return true },
    read()   { return chunks.join('') },
  }
}
