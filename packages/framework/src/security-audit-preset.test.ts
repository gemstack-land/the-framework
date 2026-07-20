import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  renderSecurityAuditPrompt,
  SECURITY_AUDIT_PARAMS,
  SECURITY_AUDIT_PROMPT_TEMPLATE,
} from './security-audit-preset.js'

test('the Security audit template carries the #461 prompt: exhaustive, per-aspect verdict, separate commits', () => {
  assert.match(SECURITY_AUDIT_PROMPT_TEMPLATE, /^Security audit/)
  assert.match(SECURITY_AUDIT_PROMPT_TEMPLATE, /exhaustive \(100% coverage\)/)
  assert.match(SECURITY_AUDIT_PROMPT_TEMPLATE, /verdict/)
  assert.match(SECURITY_AUDIT_PROMPT_TEMPLATE, /each security issue in a separate commit/)
  // The one user blank, declared with its default.
  assert.match(SECURITY_AUDIT_PROMPT_TEMPLATE, /\$\{\{ tf\.params\.what \}\}/)
  assert.deepEqual(SECURITY_AUDIT_PARAMS.map(p => p.name), ['what'])
})

test('renderSecurityAuditPrompt defaults the blank to the session, else the whole codebase (#874)', () => {
  const byDefault = renderSecurityAuditPrompt()
  assert.match(byDefault, /^Security audit entire codebase/)
  const blank = renderSecurityAuditPrompt('   ')
  assert.match(blank, /^Security audit entire codebase/) // blank falls back, not erased
  const custom = renderSecurityAuditPrompt('the auth package')
  assert.match(custom, /^Security audit the auth package/)
  // No raw placeholder survives a render.
  assert.equal(custom.includes('${{'), false)
})
