import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  OPEN_LOOP_MODES,
  SESSION_ID_PLACEHOLDER,
  formatFrameworkEvent,
  hasSessionIdPlaceholder,
  pickedIds,
  resolveSessionLink,
} from './events.js'

test('hasSessionIdPlaceholder distinguishes templates from literal URLs', () => {
  assert.equal(hasSessionIdPlaceholder(`https://x.dev/s/${SESSION_ID_PLACEHOLDER}`), true)
  assert.equal(hasSessionIdPlaceholder('https://x.dev/live'), false)
})

test('pickedIds normalizes a single id or a subset to a list (#332)', () => {
  assert.deepEqual(pickedIds('proceed'), ['proceed'])
  assert.deepEqual(pickedIds(['p0', 'p2']), ['p0', 'p2'])
  assert.deepEqual(pickedIds([]), [])
  assert.deepEqual(pickedIds(''), [])
})

test('formatFrameworkEvent renders a multi-select choice as a checklist (#332)', () => {
  const line = formatFrameworkEvent({
    kind: 'choice',
    id: 'ms',
    title: 'Pick problems to deep-dive',
    multi: true,
    options: [
      { id: 'p0', label: 'auth flow', default: true },
      { id: 'p1', label: 'routing' },
    ],
  })
  assert.equal(line, '? Pick problems to deep-dive\n    [x] auth flow\n    [ ] routing')
})

test('formatFrameworkEvent renders a single-select choice with the recommended mark (#304)', () => {
  const line = formatFrameworkEvent({
    kind: 'choice',
    id: 'plan',
    title: 'Approve this plan?',
    recommended: 'proceed',
    options: [
      { id: 'proceed', label: 'Proceed: Vike' },
      { id: 'alt:0', label: 'Use Next.js instead' },
    ],
  })
  assert.equal(line, '? Approve this plan?\n    ● Proceed: Vike\n    ○ Use Next.js instead')
})

test('formatFrameworkEvent renders a resolved subset, and (none) when empty (#332)', () => {
  assert.equal(
    formatFrameworkEvent({ kind: 'choice-resolved', id: 'ms', picked: ['p0', 'p2'], by: 'user' }),
    '  ✓ chose p0, p2 (user)',
  )
  assert.equal(
    formatFrameworkEvent({ kind: 'choice-resolved', id: 'ms', picked: [], by: 'auto' }),
    '  ✓ chose (none) (auto)',
  )
  assert.equal(
    formatFrameworkEvent({ kind: 'choice-resolved', id: 'plan', picked: 'proceed', by: 'user' }),
    '  ✓ chose proceed (user)',
  )
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

test('formatFrameworkEvent renders a system-prompt line by length (#343)', () => {
  assert.equal(formatFrameworkEvent({ kind: 'system-prompt', text: 'abcde' }), '  system prompt sent (5 chars)')
})

test('formatFrameworkEvent shows a preview of the driver prompt, not just "prompt sent" (#476)', () => {
  assert.equal(
    formatFrameworkEvent({ kind: 'driver', event: { type: 'start', prompt: 'Build this app end to end' } }),
    '  › prompt: Build this app end to end',
  )
  // Long prompts are truncated for the one-line feed (the dashboard shows the full text).
  const long = 'x'.repeat(300)
  const line = formatFrameworkEvent({ kind: 'driver', event: { type: 'start', prompt: long } })!
  assert.ok(line.startsWith('  › prompt: '))
  assert.ok(line.length < 160 && line.endsWith('…'))
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

test('formats the rate-limit line by how much the quota actually matters (#517)', () => {
  const at = Date.UTC(2026, 6, 15, 4, 30)
  const line = (status: string) => formatFrameworkEvent({ kind: 'driver', event: { type: 'rate-limit', limit: { status, window: 'five_hour', resetsAt: at } } })!
  assert.match(line('allowed'), /^\s+· quota allowed \(five_hour\)/)
  assert.match(line('allowed_warning'), /^\s+! quota running low \(five_hour\)/)
  assert.match(line('rejected'), /^\s+✗ quota exhausted \(five_hour\)/)
  // An unseen status still renders rather than blowing up or vanishing.
  assert.match(line('some_new_status'), /quota some_new_status/)
  assert.ok(line('allowed').includes(new Date(at).toISOString()))
})
