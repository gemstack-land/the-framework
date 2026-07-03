import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseArgs, runCli, type CliIO } from './cli.js'

function capture(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: l => out.push(l), err: l => err.push(l) }, out, err }
}

test('parseArgs reads flags and the intent words', () => {
  const opts = parseArgs(['--fake', '--scope', 'prototype', 'a', 'blog', 'app'])
  assert.equal(opts.fake, true)
  assert.equal(opts.scope, 'prototype')
  assert.equal(opts.intent, 'a blog app')
})

test('parseArgs flags unknown options and bad values', () => {
  assert.match(parseArgs(['--nope']).error!, /unknown option/)
  assert.match(parseArgs(['--scope', 'huge']).error!, /invalid --scope/)
  assert.match(parseArgs(['--max-passes', '0']).error!, /max-passes/)
  assert.match(parseArgs(['--permission-mode', 'wat']).error!, /permission-mode/)
})

test('parseArgs reads permission-mode and skip-permissions', () => {
  const opts = parseArgs(['--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions', 'x'])
  assert.equal(opts.permissionMode, 'bypassPermissions')
  assert.equal(opts.skipPermissions, true)
})

test('runCli --help prints usage and exits 0', async () => {
  const { io, out } = capture()
  const code = await runCli(['--help'], io)
  assert.equal(code, 0)
  assert.match(out.join('\n'), /Usage:/)
})

test('runCli usage error exits 2', async () => {
  const { io } = capture()
  assert.equal(await runCli(['--bogus'], io), 2)
  assert.equal(await runCli([], io), 2) // no intent, not fake
})

test('runCli --fake --no-dashboard runs the whole flow offline to production-grade', async () => {
  const { io, out } = capture()
  const code = await runCli(['--fake', '--no-dashboard'], io)
  assert.equal(code, 0)
  const text = out.join('\n')
  assert.match(text, /architect:/)
  assert.match(text, /checklist pass 1/)
  assert.match(text, /production-grade/)
  assert.match(text, /deploy: SSR/)
})
