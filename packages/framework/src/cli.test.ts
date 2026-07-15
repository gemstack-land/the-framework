import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { appendControl } from './control.js'
import { daemonStatePath } from './daemon.js'
import { EVENTS_FILE, FRAMEWORK_DIR } from './store/index.js'
import {
  activeModes,
  antiLazyPillOff,
  buildDeployTarget,
  chooseSessionLink,
  claudeDriverOptions,
  CLAUDE_CODE_SESSION_LIST,
  ecoOptions,
  frameworkVersion,
  mergeRunConfig,
  parseArgs,
  promptRunArgs,
  resolveDomainPreset,
  runCli,
  runLogEntry,
  runLogKind,
  runPostMerge,
  unguardedNotices,
  withBrowser,
  BROWSER_MCP_SERVERS,
  type CliIO,
} from './cli.js'
import { readLogs } from './logs.js'
import { createDriver } from './agent.js'
import { FakeDriver } from './driver/index.js'
import type { FrameworkEvent } from './events.js'

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

test('parseArgs reads the backlog-loop flags (#323)', () => {
  const dflt = parseArgs(['x'])
  assert.equal(dflt.todoLoop, true)
  assert.equal(dflt.todoMaxItems, undefined)
  assert.equal(parseArgs(['--no-todo-loop', 'x']).todoLoop, false)
  assert.equal(parseArgs(['--max-todo-items', '5', 'x']).todoMaxItems, 5)
  assert.match(parseArgs(['--max-todo-items', '0', 'x']).error!, /max-todo-items/)
})

test('parseArgs collects repeatable --context directories (#439)', () => {
  assert.deepEqual(parseArgs(['x']).context, [])
  assert.deepEqual(parseArgs(['--context', '/work/api', '--context', '/work/ui', 'x']).context, ['/work/api', '/work/ui'])
})

test('parseArgs reads --post-merge (#326)', () => {
  assert.equal(parseArgs(['x']).postMerge, false)
  assert.equal(parseArgs(['--post-merge', 'x']).postMerge, true)
})

test('parseArgs reads --browser (#452)', () => {
  assert.equal(parseArgs(['x']).browser, false)
  assert.equal(parseArgs(['--browser', 'x']).browser, true)
})

test('withBrowser folds chrome-devtools-mcp into driver options only when enabled (#452)', () => {
  const base = claudeDriverOptions({ skipPermissions: false })
  assert.equal(withBrowser(base, false).mcpServers, undefined)
  const withIt = withBrowser(base, true)
  assert.deepEqual(withIt.mcpServers, BROWSER_MCP_SERVERS)
  // Non-mutating: the base options are untouched.
  assert.equal(base.mcpServers, undefined)
})

test('promptRunArgs runs a headless prompt and carries NO --post-merge (recursion guard, #326)', () => {
  const args = promptRunArgs('audit this', '/work/app', '/bin/framework', 3)
  assert.deepEqual(args, ['/bin/framework', 'prompt', 'audit this', '--no-dashboard', '--cwd', '/work/app', '--max-cost', '3'])
  // The guard: a queued pass must not trigger its own post-merge prompt.
  assert.equal(args.includes('--post-merge'), false)
  // maxCost is optional.
  assert.equal(promptRunArgs('x', '/w', '/bin/f').includes('--max-cost'), false)
})

test('runPostMerge queues the follow-ups in ONE run instead of running the presets (#326/#556)', async () => {
  const { io } = capture()
  const seen: string[] = []
  const run = (prompt: string) => {
    seen.push(prompt)
    return Promise.resolve(true)
  }
  await runPostMerge('/work/app', '/bin/framework', io, { session_name: 'add-oauth' }, undefined, undefined, run)
  // One child run, not three: it asks for TODO entries rather than doing the passes.
  assert.equal(seen.length, 1)
  const prompt = seen[0]!
  assert.match(prompt, /add the following to <TODO_FILE>/)
  assert.match(prompt, /Apply preset `maintainability` on the changes introduced by add-oauth/)
  assert.match(prompt, /Apply preset `security_audit` on the changes introduced by add-oauth/)
  // The preset prompts themselves are not what gets sent any more.
  assert.doesNotMatch(prompt, /easy as possible for humans to read/)
  assert.ok(!prompt.includes('${{'), 'fully rendered')
})

test('runPostMerge gates the readability entry on technical_control (#326)', async () => {
  const { io } = capture()
  const render = async (technical_control: boolean) => {
    const seen: string[] = []
    await runPostMerge(
      '/work/app',
      '/bin/framework',
      io,
      { session_name: 'add-oauth', settings: { technical_control } },
      undefined,
      undefined,
      p => {
        seen.push(p)
        return Promise.resolve(true)
      },
    )
    return seen[0]!
  }
  assert.match(await render(true), /Apply preset `readability` on the changes introduced by add-oauth/)
  assert.doesNotMatch(await render(false), /readability/)
})

test('runPostMerge is best-effort: a failed queueing run is reported, never thrown (#326)', async () => {
  const { io, out } = capture()
  await runPostMerge('/work/app', '/bin/framework', io, { session_name: 'add-oauth' }, undefined, undefined, () =>
    Promise.resolve(false),
  )
  assert.ok(out.some(l => /post-merge queueing did not complete/.test(l)))
})

test('parseArgs reads the maintain subcommand + its bounds (#298)', () => {
  const dflt = parseArgs(['x'])
  assert.equal(dflt.maintain, false)
  assert.equal(dflt.dryRun, false)

  const m = parseArgs(['maintain', '--dry-run'])
  assert.equal(m.maintain, true)
  assert.equal(m.dryRun, true)
  assert.equal(m.intent, '') // maintain takes no positional args

  assert.equal(parseArgs(['maintain', '--max-repos', '3']).maxRepos, 3)
  assert.match(parseArgs(['maintain', '--max-repos', '0']).error!, /max-repos/)
})

test('parseArgs reads the Global options flags: vanilla + eco (#314)', () => {
  const dflt = parseArgs(['x'])
  assert.equal(dflt.vanilla, false)
  assert.deepEqual(dflt.eco, { autoPlanning: false, autoResearch: false, autoMaintenance: false })
  const on = parseArgs(['--vanilla', '--eco-auto-planning', '--eco-auto-maintenance', 'x'])
  assert.equal(on.vanilla, true)
  assert.deepEqual(on.eco, { autoPlanning: true, autoResearch: false, autoMaintenance: true })
})

test('ecoOptions returns undefined when nothing is set, else only the enabled drops (#314)', () => {
  assert.equal(ecoOptions(parseArgs(['x'])), undefined)
  assert.deepEqual(ecoOptions(parseArgs(['--eco-auto-research', 'x'])), {
    autoPlanning: false,
    autoResearch: true,
    autoMaintenance: false,
  })
})

test('antiLazyPillOff is true for --vanilla or the-framework.yml antiLazyPill:false (#314)', () => {
  assert.equal(antiLazyPillOff(parseArgs(['x']), {}), false)
  assert.equal(antiLazyPillOff(parseArgs(['--vanilla', 'x']), {}), true)
  assert.equal(antiLazyPillOff(parseArgs(['x']), { antiLazyPill: false }), true)
})

test('runLogKind maps the run path to a project-log kind (#379)', () => {
  assert.equal(runLogKind({ directPrompt: false, research: false }), 'build')
  assert.equal(runLogKind({ directPrompt: true, research: false }), 'prompt')
  assert.equal(runLogKind({ directPrompt: false, research: true }), 'prompt')
})

test('runLogEntry maps the end event to a status and carries the session (#379)', () => {
  const base = { at: '2026-07-11T00:00:00.000Z', kind: 'build' as const, title: 'a blog' }
  assert.equal(runLogEntry({ ...base, end: { kind: 'end', ok: true } }).status, 'done')
  assert.equal(runLogEntry({ ...base, end: { kind: 'end', ok: false, stopped: true } }).status, 'stopped')
  assert.equal(runLogEntry({ ...base, end: { kind: 'end', ok: false } }).status, 'failed')
  const withSession = runLogEntry({ ...base, end: { kind: 'end', ok: true }, sessionId: 's1', sessionLink: 'http://x/s1' })
  assert.equal(withSession.sessionId, 's1')
  assert.equal(withSession.sessionLink, 'http://x/s1')
  // No session captured -> the fields are omitted, not set to undefined.
  assert.equal('sessionId' in runLogEntry({ ...base, end: { kind: 'end', ok: true } }), false)
})

test('a finished run records itself in .the-framework/LOGS.md (#379)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'framework-logs-'))
  try {
    const { io } = capture()
    const code = await runCli(['prompt', 'review the auth flow', '--fake', '--no-dashboard', '--cwd', dir], io)
    assert.equal(code, 0)
    const logs = await readLogs(dir)
    assert.equal(logs.length, 1)
    assert.equal(logs[0]!.kind, 'prompt')
    assert.equal(logs[0]!.title, 'review the auth flow')
    assert.equal(logs[0]!.status, 'done')
    assert.match(logs[0]!.at, /^\d{4}-\d{2}-\d{2}T/) // a real ISO timestamp
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('parseArgs reads the research subcommand with its optional what (#331)', () => {
  const bare = parseArgs(['research'])
  assert.equal(bare.research, true)
  assert.equal(bare.intent, '') // the "what" defaults downstream (this PR)
  const withWhat = parseArgs(['research', 'the', 'auth', 'flow'])
  assert.equal(withWhat.research, true)
  assert.equal(withWhat.intent, 'the auth flow')
  assert.equal(parseArgs(['build', 'a', 'blog']).research, false)
})

test('parseArgs reads the prompt subcommand with its verbatim text (#353)', () => {
  const p = parseArgs(['prompt', 'review', 'the', 'auth', 'flow'])
  assert.equal(p.directPrompt, true)
  assert.equal(p.intent, 'review the auth flow')
  assert.equal(parseArgs(['build', 'a', 'blog']).directPrompt, false)
})

test('frameworkVersion reports the real package version, not the 0.0.0 placeholder (#312)', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(frameworkVersion(), pkg.version)
  assert.notEqual(frameworkVersion(), '0.0.0')
})

test('runCli --version prints the real version (#312)', async () => {
  const { io, out } = capture()
  const code = await runCli(['--version'], io)
  assert.equal(code, 0)
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.deepEqual(out, [pkg.version])
})

test('runCli errors on a bare `framework prompt` (nothing to run, #353)', async () => {
  const { io, err } = capture()
  const code = await runCli(['prompt'], io)
  assert.equal(code, 2)
  assert.ok(err.some(l => /needs the prompt text/.test(l)))
})

test('runCli prompt runs the text through the direct path (#353)', async () => {
  const { io, out } = capture()
  const code = await runCli(['prompt', 'say hi', '--fake', '--no-dashboard'], io)
  assert.equal(code, 0)
  assert.ok(out.some(l => /prompt run done/.test(l)))
})

test('parseArgs reads the stop subcommand and the --daemon / internal --daemon-serve flags (#456)', () => {
  const stop = parseArgs(['stop'])
  assert.equal(stop.stop, true)
  assert.equal(stop.intent, '') // "stop" is a command, not build intent
  const daemon = parseArgs(['--daemon', '--port', '4477'])
  assert.equal(daemon.daemon, true)
  assert.equal(daemon.daemonServe, false)
  assert.equal(daemon.port, 4477)
  const serve = parseArgs(['--daemon-serve', '--port', '4477'])
  assert.equal(serve.daemonServe, true)
  assert.equal(serve.daemon, false)
  assert.equal(parseArgs([]).stop, false) // bare invocation is not stop
})

test('parseArgs flags unknown options and bad values', () => {
  assert.match(parseArgs(['--nope']).error!, /unknown option/)
  assert.match(parseArgs(['--scope', 'huge']).error!, /invalid --scope/)
  assert.match(parseArgs(['--max-passes', '0']).error!, /max-passes/)
  assert.match(parseArgs(['--max-cost', '0']).error!, /max-cost/)
  assert.match(parseArgs(['--max-cost', 'abc']).error!, /max-cost/)
  assert.match(parseArgs(['--permission-mode', 'wat']).error!, /permission-mode/)
  assert.match(parseArgs(['--agent', 'gemini']).error!, /invalid --agent/)
  assert.match(parseArgs(['--agent']).error!, /invalid --agent/)
})

test('parseArgs reads --agent, defaulting to claude (#542)', () => {
  assert.equal(parseArgs(['x']).agent, 'claude')
  assert.equal(parseArgs(['--agent', 'claude', 'x']).agent, 'claude')
  assert.equal(parseArgs(['--agent', 'codex', 'x']).agent, 'codex')
})

test('createDriver builds the agent --agent picked (#542)', () => {
  assert.equal(createDriver({ agent: 'claude' }).name, 'claude-code')
  assert.equal(createDriver({ agent: 'codex' }).name, 'codex')
})

test('unguardedNotices says --max-cost cannot gate an agent with no price (#542/#540)', () => {
  // The whole point: the cap is only checked on a turn that reports a price, so
  // on Codex it silently never fires. Saying nothing would read as capped.
  const notes = unguardedNotices({ agent: 'codex', maxCost: 5, browser: false, permissionMode: undefined, skipPermissions: false })
  assert.equal(notes.length, 1)
  assert.match(notes[0]!, /--max-cost \$5 cannot be enforced/)
  assert.match(notes[0]!, /Codex/)
})

test('unguardedNotices is silent when the guards really do apply (#542)', () => {
  const claude = unguardedNotices({ agent: 'claude', maxCost: 5, browser: true, permissionMode: 'plan', skipPermissions: true })
  assert.deepEqual(claude, [])
  const noFlags = unguardedNotices({ agent: 'codex', browser: false, permissionMode: undefined, skipPermissions: false })
  assert.deepEqual(noFlags, [])
})

test('unguardedNotices flags the Claude-only flags on another agent (#542)', () => {
  const notes = unguardedNotices({ agent: 'codex', browser: true, permissionMode: 'plan', skipPermissions: false })
  assert.equal(notes.length, 2)
  assert.match(notes[0]!, /--browser has no effect/)
  assert.match(notes[1]!, /--permission-mode/)
})

test('parseArgs reads --max-cost as a positive USD budget (#322)', () => {
  assert.equal(parseArgs(['--max-cost', '2.5', 'x']).maxCost, 2.5)
  assert.equal(parseArgs(['x']).maxCost, undefined)
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

test('parseArgs reads --sandbox and rejects an unknown value (#229)', () => {
  assert.equal(parseArgs(['--sandbox', 'docker', 'x']).sandbox, 'docker')
  assert.equal(parseArgs(['--sandbox', 'local', 'x']).sandbox, 'local')
  assert.equal(parseArgs(['x']).sandbox, undefined)
  assert.match(parseArgs(['--sandbox', 'vm', 'x']).error!, /invalid --sandbox/)
})

test('parseArgs reads the relay subcommand and --share (#230)', () => {
  const relay = parseArgs(['relay', '--port', '5000'])
  assert.equal(relay.relayServe, true)
  assert.equal(relay.intent, '') // 'relay' is a subcommand, not an intent word
  assert.equal(relay.port, 5000)
  const share = parseArgs(['--share', 'http://host:4488', 'a', 'blog'])
  assert.equal(share.share, 'http://host:4488')
  assert.equal(share.intent, 'a blog')
  assert.equal(parseArgs(['x']).relayServe, false)
  assert.equal(parseArgs(['x']).share, undefined)
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
  const code = await runCli(['--fake', '--no-dashboard', '--technical'], io)
  assert.equal(code, 0)
  assert.ok(err.some(l => /technical mode\(s\) have no effect without a preset/.test(l)))
})

test('runCli does not note --autopilot without a preset (it steers the #326 prompt)', async () => {
  const { io, err } = capture()
  const code = await runCli(['--fake', '--no-dashboard', '--autopilot'], io)
  assert.equal(code, 0)
  assert.ok(!err.some(l => /have no effect without a preset/.test(l)))
})

test('runCli notes --kind given without a preset (#265)', async () => {
  const { io, err } = capture()
  const code = await runCli(['--fake', '--no-dashboard', '--kind', 'bug-fix'], io)
  assert.equal(code, 0)
  assert.ok(err.some(l => /build event "bug-fix" has no effect without a preset/.test(l)))
})

test('runCli notes --sandbox docker given without --serve (#229)', async () => {
  const { io, err } = capture()
  const code = await runCli(['--fake', '--no-dashboard', '--sandbox', 'docker'], io)
  assert.equal(code, 0)
  assert.ok(err.some(l => /--sandbox docker has no effect without --serve/.test(l)))
})

test('chooseSessionLink defaults a live run to the claude.ai/code session list (#212)', () => {
  assert.equal(chooseSessionLink({ sessionLink: undefined, agent: 'claude' }, false), CLAUDE_CODE_SESSION_LIST)
  assert.equal(CLAUDE_CODE_SESSION_LIST, 'https://claude.ai/code')
})

test('chooseSessionLink honors an explicit --session-link over the default', () => {
  assert.equal(chooseSessionLink({ sessionLink: 'https://x/s/{sessionId}', agent: 'claude' }, false), 'https://x/s/{sessionId}')
  // An explicit link is the user's own, so it stands whatever agent runs.
  assert.equal(chooseSessionLink({ sessionLink: 'https://x/s/{sessionId}', agent: 'codex' }, false), 'https://x/s/{sessionId}')
})

test('chooseSessionLink gives no link for a fake run (no real session)', () => {
  assert.equal(chooseSessionLink({ sessionLink: undefined, agent: 'claude' }, true), undefined)
})

test('chooseSessionLink does not point a non-Claude session at claude.ai (#542)', () => {
  assert.equal(chooseSessionLink({ sessionLink: undefined, agent: 'codex' }, false), undefined)
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
})

test('runCli bare framework foregrounds the dashboard, deferring to a running background daemon (#456)', async () => {
  const { io, out } = capture()
  const cfg = await mkdtemp(join(tmpdir(), 'framework-fg-'))
  const prevXdg = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = cfg
  try {
    // Seed a live background daemon (this process is alive) so the foreground path
    // short-circuits before binding a port and blocking the test.
    const statePath = daemonStatePath(process.env)
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(
      statePath,
      JSON.stringify({ pid: process.pid, port: 4200, url: 'http://localhost:4200', startedAt: new Date().toISOString() }),
    )
    const code = await runCli(['--cwd', cfg], io)
    assert.equal(code, 0)
    assert.ok(out.some(l => /already running in the background/.test(l)))
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prevXdg
    await rm(cfg, { recursive: true, force: true })
  }
})

test('runCli --daemon backgrounds the dashboard, not a usage error (#302/#456)', async () => {
  const { io, err } = capture()
  const cwd = await mkdtemp(join(tmpdir(), 'framework-daemon-'))
  try {
    // `--daemon` routes to ensureDaemonCmd. The spawn is refused from a test entry (it
    // would re-exec this test file and fork-bomb), so it degrades to exit 1 — the point
    // is it never spawns and is not a usage error (exit 2).
    const code = await runCli(['--daemon', '--cwd', cwd], io)
    assert.notEqual(code, 2)
    assert.ok(err.some(l => /dashboard daemon/.test(l)))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
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
  assert.match(text, /claude:/)
  assert.ok(code === 0 || code === 1) // depends on whether claude is installed here
})

test('runCli doctor checks the agent you asked for (#542)', async () => {
  const { io, out } = capture()
  const code = await runCli(['doctor', '--agent', 'codex'], io)
  const text = out.join('\n')
  assert.match(text, /codex:/)
  assert.doesNotMatch(text, /claude:/)
  assert.ok(code === 0 || code === 1) // depends on whether codex is installed here
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
  assert.match(text, /scope: full/) // the run opens on scope now that the architect is gone
  assert.match(text, /Build this app end to end/)
  assert.match(text, /checklist pass 1/)
  assert.match(text, /production-grade/)
  assert.match(text, /deploy: SSR/)
})

test('a live daemon steers a dashboard-less run through its gates via control.jsonl (#344)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-ws-'))
  const cfg = await mkdtemp(join(tmpdir(), 'framework-cfg-'))
  const prevAwait = process.env.FRAMEWORK_FAKE_AWAIT
  const prevXdg = process.env.XDG_CONFIG_HOME
  process.env.FRAMEWORK_FAKE_AWAIT = 'choices' // the fake build stops to ask (#341)
  process.env.XDG_CONFIG_HOME = cfg // the run reads the global daemon liveness from here (#393)
  try {
    // Fake the machine's live daemon (#393): our own pid always reads as alive. The
    // run's steering check is now global, so the liveness goes in the config dir.
    await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
    await writeFile(
      daemonStatePath(),
      JSON.stringify({ pid: process.pid, port: 1, url: 'http://127.0.0.1:1', startedAt: '' }),
    )

    const { io, out } = capture()
    let settled = false
    const done = runCli(['--fake', '--no-dashboard', '--cwd', cwd], io).finally(() => (settled = true))

    // Play the daemon: tail events.jsonl for the build's parked await-choices gate and
    // answer it with its recommended pick, exactly as the daemon page's Accept button would.
    const answered = new Set<string>()
    const eventsPath = join(cwd, FRAMEWORK_DIR, EVENTS_FILE)
    for (let i = 0; i < 500 && !settled; i++) {
      const lines = await readFile(eventsPath, 'utf8').then(s => s.split('\n').filter(Boolean), () => [])
      for (const l of lines) {
        let e: { kind?: string; id?: string; recommended?: string; options?: { id: string }[] }
        try {
          e = JSON.parse(l)
        } catch {
          continue
        }
        if (e.kind !== 'choice' || !e.id || answered.has(e.id)) continue
        answered.add(e.id)
        await appendControl(cwd, { kind: 'choice', id: e.id, pick: e.recommended ?? e.options?.[0]?.id ?? '', by: 'user' })
      }
      await new Promise(r => setTimeout(r, 20))
    }

    assert.equal(await done, 0)
    assert.ok(answered.has('await-choices'), 'the build await gate parked and was steered')
    assert.match(out.join('\n'), /production-grade/)
    // The resolution was attributed to the steering user, not a headless auto-accept.
    const resolved = (await readFile(eventsPath, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter((e: { kind: string }) => e.kind === 'choice-resolved')
    assert.equal(resolved.length, 1)
    assert.ok(resolved.every((e: { by: string }) => e.by === 'user'))
  } finally {
    if (prevAwait === undefined) delete process.env.FRAMEWORK_FAKE_AWAIT
    else process.env.FRAMEWORK_FAKE_AWAIT = prevAwait
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prevXdg
    await rm(cwd, { recursive: true, force: true })
    await rm(cfg, { recursive: true, force: true })
  }
})
