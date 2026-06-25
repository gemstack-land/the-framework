/**
 * `pnpm rudder ai:eval` CLI handler tests (#A5 Phase 2).
 *
 * Covers:
 *  - parseArgs: positional name filter + --bail / --json flags
 *  - discoverSuiteFiles: pattern parsing + recursive walk
 *  - runEvalCli: name-filter exclusion, --bail short-circuit, --json shape
 *
 * Real provider calls are stubbed via AiFake so suites complete in
 * milliseconds without API keys.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Agent } from './agent.js'
import { AiFake } from './fake.js'
import { evalSuite, exactMatch, type EvalSuite } from './eval/index.js'
import {
  parseArgs,
  discoverSuiteFiles,
  runEvalCli,
} from './commands/ai-eval.js'

class StubAgent extends Agent {
  instructions() { return 'stub' }
}

// ─── parseArgs ──────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses --bail and --json flags', () => {
    const o = parseArgs(['--bail', '--json'])
    assert.equal(o.bail, true)
    assert.equal(o.json, true)
    assert.equal(o.filter, undefined)
  })

  it('treats the first positional as a name filter', () => {
    const o = parseArgs(['support', '--json'])
    assert.equal(o.filter, 'support')
    assert.equal(o.json, true)
    assert.equal(o.bail, false)
  })

  it('returns false flags when omitted', () => {
    const o = parseArgs([])
    assert.equal(o.bail, false)
    assert.equal(o.json, false)
  })
})

// ─── discoverSuiteFiles ─────────────────────────────────────

describe('discoverSuiteFiles', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-disco-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('walks evals/**/*.eval.ts by default', async () => {
    await mkdir(path.join(dir, 'evals', 'agents'), { recursive: true })
    await writeFile(path.join(dir, 'evals', 'a.eval.ts'),         'export {}\n')
    await writeFile(path.join(dir, 'evals', 'agents', 'b.eval.ts'), 'export {}\n')
    await writeFile(path.join(dir, 'evals', 'helper.ts'),          'export {}\n')   // wrong suffix
    await writeFile(path.join(dir, 'unrelated.eval.ts'),           'export {}\n')   // outside root

    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    const rels  = files.map(f => path.relative(dir, f))
    assert.deepEqual(rels, [
      path.join('evals', 'a.eval.ts'),
      path.join('evals', 'agents', 'b.eval.ts'),
    ])
  })

  it('skips node_modules and dotfile dirs', async () => {
    await mkdir(path.join(dir, 'evals', 'node_modules', 'pkg'), { recursive: true })
    await mkdir(path.join(dir, 'evals', '.cache'),               { recursive: true })
    await writeFile(path.join(dir, 'evals', 'a.eval.ts'),                                 'export {}\n')
    await writeFile(path.join(dir, 'evals', 'node_modules', 'pkg', 'fake.eval.ts'),       'export {}\n')
    await writeFile(path.join(dir, 'evals', '.cache', 'cached.eval.ts'),                  'export {}\n')

    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    assert.equal(files.length, 1)
    assert.match(files[0]!, /a\.eval\.ts$/)
  })

  it('returns [] when the root dir does not exist', async () => {
    const files = await discoverSuiteFiles(dir, 'evals/**/*.eval.ts')
    assert.deepEqual(files, [])
  })

  it('honors a custom <dir>/**/*<suffix> pattern', async () => {
    await mkdir(path.join(dir, 'tests', 'agents'), { recursive: true })
    await writeFile(path.join(dir, 'tests', 'agents', 'one.spec.ts'), 'export {}\n')
    const files = await discoverSuiteFiles(dir, 'tests/**/*.spec.ts')
    assert.equal(files.length, 1)
  })

  it('throws on patterns that aren\'t <dir>/**/*<suffix>-shaped', async () => {
    await assert.rejects(
      () => discoverSuiteFiles(dir, 'evals/[abc]/file.ts'),
      /Unsupported eval pattern/,
    )
  })
})

// ─── runEvalCli ─────────────────────────────────────────────

interface CapturedStream {
  write(s: string): boolean
  read(): string
}
function capture(): CapturedStream {
  const chunks: string[] = []
  return {
    write(s: string): boolean { chunks.push(s); return true },
    read(): string { return chunks.join('') },
  }
}

function makePassingSuite(name: string): EvalSuite {
  return evalSuite(name, {
    agent: () => new StubAgent(),
    cases: [{ name: 'c1', input: 'hi', assert: exactMatch('hi') }],
  })
}

function makeFailingSuite(name: string): EvalSuite {
  return evalSuite(name, {
    agent: () => new StubAgent(),
    cases: [{ name: 'c1', input: 'hi', assert: exactMatch('not-hi') }],
  })
}

describe('runEvalCli', () => {
  let fake: AiFake
  beforeEach(() => { fake = AiFake.fake() })

  it('runs matching suites in console mode and returns 0 when all pass', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: false },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makePassingSuite('A'),
      },
    )
    assert.equal(code, 0)
    assert.match(stdout.read(), /1 passed, 0 failed/)
  })

  it('returns 1 and prints failure when a case fails', async () => {
    fake.respondWith('something else')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: false },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makeFailingSuite('A'),
      },
    )
    assert.equal(code, 1)
    assert.match(stdout.read(), /0 passed, 1 failed/)
  })

  it('--bail stops on the first failing suite', async () => {
    fake.respondWith('wrong')

    const seen: string[] = []
    const code = await runEvalCli(
      { bail: true, json: false },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts', '/virtual/evals/b.eval.ts'],
        loadSuite:     async (file: string) => {
          seen.push(path.basename(file))
          if (file.endsWith('a.eval.ts')) return makeFailingSuite('A')
          if (file.endsWith('b.eval.ts')) return makePassingSuite('B')
          return null
        },
      },
    )
    assert.equal(code, 1)
    assert.deepEqual(seen, ['a.eval.ts'])  // never reaches b.eval.ts
  })

  it('--json emits a {suites: [...]} envelope and skips console output', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: true },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts'],
        loadSuite:     async () => makePassingSuite('A'),
      },
    )
    assert.equal(code, 0)
    const out = stdout.read()
    // Console reporter would print "passed, failed" lines — JSON mode must not.
    assert.doesNotMatch(out, /passed, .* failed/)
    const parsed = JSON.parse(out) as { suites: Array<{ suite: string; passed: number; failed: number; cases: unknown[] }> }
    assert.equal(parsed.suites.length, 1)
    assert.equal(parsed.suites[0]!.suite, 'A')
    assert.equal(parsed.suites[0]!.passed, 1)
    assert.equal(parsed.suites[0]!.failed, 0)
    assert.equal(parsed.suites[0]!.cases.length, 1)
  })

  it('positional filter excludes non-matching suite names (case-insensitive substring)', async () => {
    fake.respondWith('hi')
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { filter: 'support', bail: false, json: true },
      {
        cwd:           '/virtual',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/a.eval.ts', '/virtual/evals/b.eval.ts'],
        loadSuite:     async (file: string) => {
          if (file.endsWith('a.eval.ts')) return makePassingSuite('SupportAgent')
          if (file.endsWith('b.eval.ts')) return makePassingSuite('BillingAgent')
          return null
        },
      },
    )
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout.read()) as { suites: Array<{ suite: string }> }
    assert.deepEqual(parsed.suites.map(s => s.suite), ['SupportAgent'])
  })

  it('emits an empty envelope (exit 0) in --json mode when no suites match', async () => {
    const stdout = capture()
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: true },
      {
        cwd:           '/no-suites',
        stdout,
        stderr,
        configPattern: () => null,
        discover:      async () => [],
        loadSuite:     async () => null,
      },
    )
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout.read()) as { suites: unknown[] }
    assert.deepEqual(parsed.suites, [])
    assert.match(stderr.read(), /no suites found/)
  })
})

// ─── --record / --replay round-trip (#A5 Phase 4) ─────────

describe('runEvalCli — --record / --replay', () => {
  let fake: AiFake
  let fixturesDir: string

  beforeEach(async () => {
    fake = AiFake.fake()
    fixturesDir = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-rec-'))
  })
  afterEach(async () => {
    fake.restore()
    await rm(fixturesDir, { recursive: true, force: true })
  })

  it('rejects --record + --replay together', async () => {
    const stderr = capture()
    const code = await runEvalCli(
      { bail: false, json: false, record: true, replay: true },
      { cwd: '/v', stdout: capture(), stderr, configPattern: () => null, discover: async () => [] },
    )
    assert.equal(code, 1)
    assert.match(stderr.read(), /mutually exclusive/)
  })

  it('--record writes one JSON fixture per case under fixturesDir/<suite>/<case>.json', async () => {
    fake.respondWithSequence([{ text: 'A reply' }, { text: 'B reply' }])
    const suite: EvalSuite = evalSuite('Sample', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'first',  input: 'a', assert: exactMatch('A reply') },
        { name: 'second', input: 'b', assert: exactMatch('B reply') },
      ],
    })
    await runEvalCli(
      { bail: false, json: true, record: true },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/sample.eval.ts'],
        loadSuite:     async () => suite,
        fixturesDir,
      },
    )
    const fs = await import('node:fs/promises')
    const firstPath  = path.join(fixturesDir, 'Sample', 'first.json')
    const secondPath = path.join(fixturesDir, 'Sample', 'second.json')
    const first  = JSON.parse(await fs.readFile(firstPath,  'utf8')) as { steps: { text: string }[]; suite: string; case: string }
    const second = JSON.parse(await fs.readFile(secondPath, 'utf8')) as { steps: { text: string }[]; case: string }
    assert.equal(first.suite, 'Sample')
    assert.equal(first.case,  'first')
    assert.equal(first.steps[0]!.text,  'A reply')
    assert.equal(second.case, 'second')
    assert.equal(second.steps[0]!.text, 'B reply')
  })

  it('--replay primes AiFake per-case from fixtures (zero stray prompts)', async () => {
    // Write a fixture by hand so replay has something to load.
    const fs = await import('node:fs/promises')
    await fs.mkdir(path.join(fixturesDir, 'Sample'), { recursive: true })
    await fs.writeFile(
      path.join(fixturesDir, 'Sample', 'replayed.json'),
      JSON.stringify({
        version:    1,
        suite:      'Sample',
        case:       'replayed',
        input:      'a',
        recordedAt: '2026-05-10T00:00:00.000Z',
        steps:      [{ text: 'fixture-text', finishReason: 'stop' }],
      }),
    )

    // The CLI handler creates its OWN AiFake via `AiFake.fake()`, replacing
    // the one we set up in beforeEach. We don't pre-script anything; the
    // handler's per-case `respondWithSequence` is what we're testing.
    fake.preventStrayPrompts()   // guard: any unscripted prompt would throw

    const suite: EvalSuite = evalSuite('Sample', {
      agent: () => new StubAgent(),
      cases: [
        { name: 'replayed', input: 'a', assert: exactMatch('fixture-text') },
      ],
    })
    const stdout = capture()
    const code = await runEvalCli(
      { bail: false, json: true, replay: true },
      {
        cwd:           '/virtual',
        stdout,
        stderr:        capture(),
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/sample.eval.ts'],
        loadSuite:     async () => suite,
        fixturesDir,
      },
    )
    assert.equal(code, 0)
    const parsed = JSON.parse(stdout.read()) as { suites: Array<{ passed: number; failed: number }> }
    assert.equal(parsed.suites[0]!.passed, 1)
    assert.equal(parsed.suites[0]!.failed, 0)
  })

  it('--replay warns on stderr when a fixture is missing', async () => {
    const suite: EvalSuite = evalSuite('Sample', {
      agent: () => new StubAgent(),
      cases: [{ name: 'no-fixture', input: 'x', assert: exactMatch('anything') }],
    })
    const stderr = capture()
    fake.respondWith('whatever')   // fallback so the case can still run
    await runEvalCli(
      { bail: false, json: true, replay: true },
      {
        cwd:           '/virtual',
        stdout:        capture(),
        stderr,
        configPattern: () => null,
        discover:      async () => ['/virtual/evals/sample.eval.ts'],
        loadSuite:     async () => suite,
        fixturesDir,
      },
    )
    assert.match(stderr.read(), /no fixture for Sample\/no-fixture/)
  })
})
