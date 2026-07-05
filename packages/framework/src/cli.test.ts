import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  activeModes,
  buildDeployTarget,
  chooseSessionLink,
  claudeDriverOptions,
  CLAUDE_CODE_SESSION_LIST,
  mergeRunConfig,
  parseArgs,
  resolveDomainPreset,
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

test('claudeDriverOptions defaults the headless CLI to bypassPermissions (#225)', () => {
  // Default run: acceptEdits would deny installs/builds/tests headlessly, so the CLI opts up.
  assert.deepEqual(claudeDriverOptions({ skipPermissions: false }), { permissionMode: 'bypassPermissions' })
  // An explicit --permission-mode still wins.
  assert.deepEqual(claudeDriverOptions({ permissionMode: 'acceptEdits', skipPermissions: false }), {
    permissionMode: 'acceptEdits',
  })
  // --dangerously-skip-permissions takes precedence over the mode.
  assert.deepEqual(claudeDriverOptions({ permissionMode: 'plan', skipPermissions: true }), {
    dangerouslySkipPermissions: true,
  })
})

test('parseArgs persists by default and reads --resume / --no-persist (#211)', () => {
  const dflt = parseArgs(['x'])
  assert.equal(dflt.persist, true)
  assert.equal(dflt.resume, false)
  const opts = parseArgs(['--resume', '--no-persist'])
  assert.equal(opts.resume, true)
  assert.equal(opts.persist, false)
})

test('parseArgs reads --preset and the mode flags (#256)', () => {
  const opts = parseArgs(['--preset', 'software-development', '--autopilot', '--technical', 'x'])
  assert.equal(opts.preset, 'software-development')
  assert.equal(opts.autopilot, true)
  assert.equal(opts.technical, true)
  const dflt = parseArgs(['x'])
  assert.equal(dflt.preset, undefined)
  assert.equal(dflt.autopilot, false)
  assert.equal(dflt.technical, false)
})

test('parseArgs reads --kind as the build event (#265)', () => {
  assert.equal(parseArgs(['--kind', 'bug-fix', 'x']).buildEvent, 'bug-fix')
  assert.equal(parseArgs(['x']).buildEvent, undefined)
})

test('activeModes maps the mode flags to Open Loop mode names', () => {
  assert.deepEqual(activeModes({ autopilot: false, technical: false }), [])
  assert.deepEqual(activeModes({ autopilot: true, technical: false }), ['autopilot'])
  assert.deepEqual(activeModes({ autopilot: true, technical: true }), ['autopilot', 'technical'])
})

test('mergeRunConfig: the-framework.yml supplies defaults, flags override (#258)', () => {
  const flags = { preset: undefined, autopilot: false, technical: false }
  // file-only: the repo config drives the run
  assert.deepEqual(mergeRunConfig(flags, { preset: 'software-development', autopilot: true }), {
    presetName: 'software-development',
    autopilot: true,
    technical: false,
  })
  // a --preset flag wins over the file's preset
  assert.equal(mergeRunConfig({ ...flags, preset: 'web-dev' }, { preset: 'software-development' }).presetName, 'web-dev')
  // modes OR together: a flag can only enable a mode
  assert.deepEqual(mergeRunConfig({ ...flags, technical: true }, { autopilot: true }), {
    autopilot: true,
    technical: true,
  })
  // nothing set anywhere: no preset, no modes
  assert.deepEqual(mergeRunConfig(flags, {}), { autopilot: false, technical: false })
  // build event: the file's `event` supplies a default, --kind overrides it (#265)
  assert.equal(mergeRunConfig(flags, { event: 'bug-fix' }).buildEvent, 'bug-fix')
  assert.equal(mergeRunConfig({ ...flags, buildEvent: 'major-change' }, { event: 'bug-fix' }).buildEvent, 'major-change')
  assert.equal(mergeRunConfig(flags, {}).buildEvent, undefined)
})

test('resolveDomainPreset resolves a shipped preset by name (#254/#256)', async () => {
  const none = await resolveDomainPreset(undefined, [])
  assert.deepEqual(none, {})

  const { preset, error } = await resolveDomainPreset('software-development', [])
  assert.equal(error, undefined)
  assert.equal(preset?.name, 'software-development')
  assert.ok((preset?.loops.length ?? 0) >= 1)

  const bad = await resolveDomainPreset('no-such-domain', [])
  assert.equal(bad.preset, undefined)
  assert.match(bad.error!, /unknown --preset: no-such-domain/)
  assert.match(bad.error!, /software-development/) // lists what's available
})

test('runCli rejects an unknown --preset with a usage error (exit 2)', async () => {
  const { io, err } = capture()
  const code = await runCli(['--preset', 'nope', 'a blog'], io)
  assert.equal(code, 2)
  assert.ok(err.some(l => /unknown --preset: nope/.test(l)))
})

test('runCli notes mode flags given without a preset', async () => {
  const { io, err } = capture()
  // --fake so the note fires before any real run; unknown-preset path is not hit.
  const code = await runCli(['--fake', '--no-dashboard', '--autopilot'], io)
  assert.equal(code, 0)
  assert.ok(err.some(l => /have no effect without a preset/.test(l)))
})

test('runCli notes --kind given without a preset (#265)', async () => {
  const { io, err } = capture()
  const code = await runCli(['--fake', '--no-dashboard', '--kind', 'bug-fix'], io)
  assert.equal(code, 0)
  assert.ok(err.some(l => /build event "bug-fix" has no effect without a preset/.test(l)))
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
