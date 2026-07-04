import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildDeployTarget,
  chooseSessionLink,
  CLAUDE_CODE_SESSION_LIST,
  parseArgs,
  runCli,
  type CliIO,
} from './cli.js'

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

test('chooseSessionLink defaults a live run to the claude.ai/code session list (#212)', () => {
  assert.equal(chooseSessionLink({ sessionLink: undefined }, false), CLAUDE_CODE_SESSION_LIST)
  assert.equal(CLAUDE_CODE_SESSION_LIST, 'https://claude.ai/code')
})

test('chooseSessionLink honors an explicit --session-link over the default', () => {
  assert.equal(chooseSessionLink({ sessionLink: 'https://x/s/{sessionId}' }, false), 'https://x/s/{sessionId}')
})

test('chooseSessionLink gives no link for a fake run (no real session)', () => {
  assert.equal(chooseSessionLink({ sessionLink: undefined }, true), undefined)
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

test('buildDeployTarget builds cloudflare, requires dokploy config, ignores unknown', () => {
  assert.equal(buildDeployTarget('cloudflare', {}, '/ws').target?.name, 'cloudflare')
  assert.match(buildDeployTarget('dokploy', {}, '/ws').error!, /dokploy-url and --dokploy-app/)
  assert.equal(
    buildDeployTarget('dokploy', { dokployUrl: 'https://d.example', dokployApp: 'app-1' }, '/ws').target?.name,
    'dokploy',
  )
  const unknown = buildDeployTarget('fly', {}, '/ws')
  assert.equal(unknown.target, undefined)
  assert.equal(unknown.error, undefined)
})

test('runCli errors when --deploy dokploy lacks its config', async () => {
  const { io } = capture()
  const code = await runCli(['--deploy', 'dokploy', '--no-dashboard', 'a small app'], io)
  assert.equal(code, 2)
})

test('parseArgs reads the doctor subcommand, not as intent', () => {
  const opts = parseArgs(['doctor'])
  assert.equal(opts.doctor, true)
  assert.equal(opts.intent, '')
})

test('runCli doctor reports checks and exits by their outcome', async () => {
  const { io, out } = capture()
  const code = await runCli(['doctor'], io)
  const text = out.join('\n')
  assert.match(text, /node:/)
  assert.match(text, /claude-code:/)
  assert.ok(code === 0 || code === 1) // depends on whether claude is installed here
})

test('runCli --fake skips preflight (offline never needs the agent CLI)', async () => {
  const { io } = capture()
  // No claude probe is invoked for --fake; this must succeed regardless of env.
  const code = await runCli(['--fake', '--no-dashboard'], io)
  assert.equal(code, 0)
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
