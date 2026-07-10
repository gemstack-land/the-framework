import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  OPEN_LOOP_MODES,
  SESSION_ID_PLACEHOLDER,
  formatFrameworkEvent,
  hasSessionIdPlaceholder,
  resolveSessionLink,
} from './events.js'

test('hasSessionIdPlaceholder distinguishes templates from literal URLs', () => {
  assert.equal(hasSessionIdPlaceholder(`https://x.dev/s/${SESSION_ID_PLACEHOLDER}`), true)
  assert.equal(hasSessionIdPlaceholder('https://x.dev/live'), false)
})

test('resolveSessionLink fills the placeholder and is a no-op for a literal', () => {
  assert.equal(resolveSessionLink('https://x.dev/s/{sessionId}', 'abc123'), 'https://x.dev/s/abc123')
  // Every occurrence is replaced.
  assert.equal(resolveSessionLink('{sessionId}-{sessionId}', 'z'), 'z-z')
  // A literal (no placeholder) comes back unchanged.
  assert.equal(resolveSessionLink('https://x.dev/live', 'abc123'), 'https://x.dev/live')
})

test('formatFrameworkEvent renders a session-update line', () => {
  assert.equal(formatFrameworkEvent({ kind: 'session-update', sessionId: 'abc123' }), '  session abc123')
  assert.equal(
    formatFrameworkEvent({ kind: 'session-update', sessionId: 'abc123', sessionLink: 'https://x.dev/s/abc123' }),
    '  session abc123 — https://x.dev/s/abc123',
  )
})

test('formatFrameworkEvent renders a preview line', () => {
  assert.equal(
    formatFrameworkEvent({ kind: 'preview', url: 'http://localhost:3000', command: 'npm run dev' }),
    '▶ your app is running at http://localhost:3000',
  )
})

test('formatFrameworkEvent renders modes as checkboxes (#272)', () => {
  assert.equal(
    formatFrameworkEvent({ kind: 'modes', all: ['autopilot', 'technical'], active: ['technical'] }),
    '  modes: [ ] autopilot  [x] technical',
  )
})

test('OPEN_LOOP_MODES is the canonical mode ordering', () => {
  assert.deepEqual([...OPEN_LOOP_MODES], ['autopilot', 'technical'])
})

test('formatFrameworkEvent distinguishes finished / stopped / failed (#218)', () => {
  assert.equal(formatFrameworkEvent({ kind: 'end', ok: true }), '✓ finished')
  assert.equal(formatFrameworkEvent({ kind: 'end', ok: false, stopped: true }), '■ stopped')
  assert.equal(formatFrameworkEvent({ kind: 'end', ok: false, detail: 'boom' }), '✗ failed: boom')
})

test('formatFrameworkEvent renders a usage spend line, with the cap when set (#322)', () => {
  const base = { kind: 'usage' as const, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  assert.equal(formatFrameworkEvent({ ...base, costUsd: 0.04, turns: 2 }), '  spend: $0.0400 over 2 turns')
  assert.equal(formatFrameworkEvent({ ...base, costUsd: 0.02, turns: 1, budgetUsd: 5 }), '  spend: $0.0200 / $5 over 1 turn')
})
