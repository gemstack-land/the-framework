import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
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
