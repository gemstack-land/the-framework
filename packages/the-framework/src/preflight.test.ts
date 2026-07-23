import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { preflight } from './preflight.js'

test('preflight passes when the agent CLI is present', async () => {
  const result = await preflight({ probe: () => Promise.resolve({ ok: true, stdout: '1.2.3 (Claude Code)' }) })
  assert.equal(result.ok, true)
  const cc = result.checks.find(c => c.name === 'claude')
  assert.equal(cc?.ok, true)
  assert.match(cc!.detail, /1\.2\.3/)
})

test('preflight fails with install guidance when the agent CLI is missing', async () => {
  const result = await preflight({ bin: 'claude', probe: () => Promise.resolve({ ok: false, stdout: '' }) })
  assert.equal(result.ok, false)
  const cc = result.checks.find(c => c.name === 'claude')
  assert.equal(cc?.ok, false)
  assert.match(cc!.detail, /not found/)
  assert.match(cc!.detail, /claude\.com\/claude-code/)
})

test('preflight probes the picked agent, not always claude (#542)', async () => {
  const probed: string[] = []
  const result = await preflight({
    agent: 'codex',
    probe: bin => {
      probed.push(bin)
      return Promise.resolve({ ok: true, stdout: 'codex-cli 0.144.4' })
    },
  })
  assert.deepEqual(probed, ['codex'])
  assert.equal(result.ok, true)
  const cli = result.checks.find(c => c.name === 'codex')
  assert.match(cli!.detail, /0\.144\.4/)
})

test('a missing codex points at the codex install, not the claude one (#542)', async () => {
  const result = await preflight({ agent: 'codex', probe: () => Promise.resolve({ ok: false, stdout: '' }) })
  assert.equal(result.ok, false)
  const cli = result.checks.find(c => c.name === 'codex')
  assert.equal(cli?.ok, false)
  assert.match(cli!.detail, /`codex` not found/)
  assert.match(cli!.detail, /openai\.com\/codex/)
})

test('preflight always reports the node version', async () => {
  const result = await preflight({ probe: () => Promise.resolve({ ok: true, stdout: 'x' }) })
  const node = result.checks.find(c => c.name === 'node')
  assert.equal(node?.ok, true)
  assert.equal(node?.detail, process.version)
})
