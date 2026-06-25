/**
 * Fixture I/O + step extraction tests for #A5 Phase 4.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  stepsFromResponse,
  type EvalFixture,
} from './eval/index.js'
import {
  defaultFixturesDir,
  fixturePath,
  slugify,
  readFixture,
  writeFixture,
} from './eval/fixtures.js'
import type { AgentResponse } from './types.js'

// ─── stepsFromResponse ──────────────────────────────────

describe('stepsFromResponse', () => {
  it('extracts assistant text + finishReason from each step', () => {
    const r: AgentResponse = {
      text: 'final',
      steps: [
        { message: { role: 'assistant', content: 'first turn' }, toolCalls: [], toolResults: [], usage: zero(), finishReason: 'stop' },
      ],
      usage: zero(),
    }
    const steps = stepsFromResponse(r)
    assert.equal(steps.length, 1)
    assert.equal(steps[0]!.text, 'first turn')
    assert.equal(steps[0]!.finishReason, 'stop')
    assert.equal(steps[0]!.toolCalls, undefined, 'no toolCalls when array is empty')
  })

  it('preserves toolCalls when present', () => {
    const r: AgentResponse = {
      text: 'done',
      steps: [
        {
          message:      { role: 'assistant', content: '' },
          toolCalls:    [{ id: 't1', name: 'lookup', arguments: { id: 42 } }],
          toolResults:  [],
          usage:        zero(),
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'done' }, toolCalls: [], toolResults: [], usage: zero(), finishReason: 'stop' },
      ],
      usage: zero(),
    }
    const steps = stepsFromResponse(r)
    assert.equal(steps.length, 2)
    assert.deepEqual(steps[0]!.toolCalls, [{ id: 't1', name: 'lookup', arguments: { id: 42 } }])
    assert.equal(steps[0]!.finishReason, 'tool_calls')
    assert.equal(steps[1]!.text, 'done')
  })

  it('drops user / tool turns and concatenates multi-part assistant text', () => {
    const r: AgentResponse = {
      text: 'full',
      steps: [
        { message: { role: 'user', content: 'q' }, toolCalls: [], toolResults: [], usage: zero(), finishReason: 'stop' },
        {
          message: {
            role:    'assistant',
            content: [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }],
          },
          toolCalls:    [],
          toolResults:  [],
          usage:        zero(),
          finishReason: 'stop',
        },
        { message: { role: 'tool', content: 'result', toolCallId: 't1' }, toolCalls: [], toolResults: [], usage: zero(), finishReason: 'stop' },
      ],
      usage: zero(),
    }
    const steps = stepsFromResponse(r)
    assert.equal(steps.length, 1, 'only assistant turn captured')
    assert.equal(steps[0]!.text, 'one two')
  })
})

// ─── slug + path helpers ────────────────────────────────

describe('slugify / fixturePath', () => {
  it('passes through letters, digits, dot, dash, underscore', () => {
    assert.equal(slugify('SupportAgent'),     'SupportAgent')
    assert.equal(slugify('case_1.eval'),      'case_1.eval')
    assert.equal(slugify('foo-bar'),          'foo-bar')
  })

  it('collapses non-safe runs to a single dash', () => {
    assert.equal(slugify('hello world!'),     'hello-world')
    assert.equal(slugify('x / y / z'),        'x-y-z')
  })

  it('returns underscore for empty / pure-symbol input', () => {
    assert.equal(slugify(''),    '_')
    assert.equal(slugify('!!!'), '_')
  })

  it('builds <dir>/<suite>/<case>.json paths', () => {
    const p = fixturePath('/tmp/fx', 'Support Agent', 'password reset!')
    assert.equal(p, path.join('/tmp/fx', 'Support-Agent', 'password-reset.json'))
  })

  it('defaultFixturesDir is <cwd>/evals/__fixtures__', () => {
    assert.equal(defaultFixturesDir('/app'), path.join('/app', 'evals', '__fixtures__'))
  })
})

// ─── readFixture / writeFixture round-trip ─────────────

describe('fixture read/write', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'ai-eval-fx-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('writes a versioned JSON file and reads it back identically', async () => {
    const file = await writeFixture(dir, 'Suite', 'case-1', {
      input: 'hello?',
      steps: [{ text: 'hi', finishReason: 'stop' }],
    })
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as EvalFixture
    assert.equal(onDisk.version, 1)
    assert.equal(onDisk.suite, 'Suite')
    assert.equal(onDisk.case,  'case-1')
    assert.equal(onDisk.input, 'hello?')
    assert.deepEqual(onDisk.steps, [{ text: 'hi', finishReason: 'stop' }])
    assert.match(onDisk.recordedAt, /^\d{4}-\d{2}-\d{2}T/)

    const reloaded = await readFixture(dir, 'Suite', 'case-1')
    assert.deepEqual(reloaded, onDisk)
  })

  it('returns null when the fixture is missing', async () => {
    const r = await readFixture(dir, 'NoSuite', 'no-case')
    assert.equal(r, null)
  })

  it('throws on a future fixture version (forces re-record)', async () => {
    // Hand-craft a forward-version file.
    const file = fixturePath(dir, 'Suite', 'case-1')
    await import('node:fs/promises').then(fs => fs.mkdir(path.dirname(file), { recursive: true }))
    await import('node:fs/promises').then(fs =>
      fs.writeFile(file, JSON.stringify({ version: 2, suite: 'Suite', case: 'case-1', input: '', recordedAt: '2026-01-01T00:00:00.000Z', steps: [] })))
    await assert.rejects(
      () => readFixture(dir, 'Suite', 'case-1'),
      /version 2; expected 1/,
    )
  })
})

// ─── helpers ────────────────────────────────────────────

function zero() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}
