import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, appendFile, rm, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FrameworkEvent } from './events.js'
import {
  EventTailer,
  readDaemonState,
  isProcessAlive,
  daemonStatus,
  stopDaemon,
  runDaemon,
  daemonStatePath,
  writeDaemonState,
  startDaemonStateHeartbeat,
  startOptionFlags,
  registerHomeProject,
  isNestedWithin,
} from './daemon.js'
import { EVENTS_FILE, FRAMEWORK_DIR, addWorktree } from './store/index.js'
import { controlPath } from './control.js'
import { projectId, listProjects, addProject } from './registry.js'
import { nodeGitRunner } from './project.js'

// The new dashboard steers + starts over Telefunc (#405/#426), not the retired /api/* HTTP
// routes. Post an RPC to the daemon's in-process `/_telefunc` mount (same-origin), keyed by
// the client-baked file path, and return the unwrapped `ret`.
async function callTelefunc(url: string, file: string, name: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${url}/_telefunc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ file, name, args }),
  })
  const text = await res.text()
  return text ? (JSON.parse(text) as { ret?: unknown }).ret : undefined
}
type StartResult = { ok: true } | { ok: false; busy?: boolean; error: string }
// The home project's id: what the browser sends for the daemon's own workspace, which the
// daemon resolves back to `cwd` (see `resolveProject`).
const homeId = (cwd: string): string => projectId(resolve(cwd))
const sendStart = (url: string, cwd: string, prompt: string, kind = 'build'): Promise<StartResult> =>
  callTelefunc(url, '/server/control.telefunc.ts', 'sendStart', [homeId(cwd), prompt, kind]) as Promise<StartResult>

test('startOptionFlags maps only enabled Global options to CLI flags (#314)', () => {
  assert.deepEqual(startOptionFlags({}), [])
  assert.deepEqual(startOptionFlags({ autopilot: true, technical: true, vanilla: true }), [
    '--autopilot',
    '--technical',
    '--vanilla',
  ])
  assert.deepEqual(startOptionFlags({ eco: { autoPlanning: true, autoMaintenance: true } }), [
    '--eco-auto-planning',
    '--eco-auto-maintenance',
  ])
  // Context (#439): one repeatable --context flag per selected dir; blanks dropped.
  assert.deepEqual(startOptionFlags({ context: ['/work/api', '  ', '/work/ui'] }), [
    '--context',
    '/work/api',
    '--context',
    '/work/ui',
  ])
  // On-before-mergeable prompt (#326): maps to --on-before-mergeable.
  assert.deepEqual(startOptionFlags({ onBeforeMergeable: true }), ['--on-before-mergeable'])
  // Browser via chrome-devtools-mcp (#452): maps to --browser.
  assert.deepEqual(startOptionFlags({ browser: true }), ['--browser'])
  // Transparent (#625): the master off-switch maps to --transparent.
  assert.deepEqual(startOptionFlags({ transparent: true }), ['--transparent'])
})

test('startOptionFlags spells an explicit off as the --no-* form (#842)', () => {
  // The launcher resolves the repo yml itself now, so a toggle it shows as off has to travel as
  // one: without --no-autopilot the file would turn it back on inside the run (#841).
  assert.deepEqual(startOptionFlags({ autopilot: false, technical: false }), ['--no-autopilot', '--no-technical'])
  assert.deepEqual(startOptionFlags({ vanilla: false, transparent: false }), ['--no-vanilla', '--no-transparent'])
  // Absent still says nothing, so the repo file keeps deciding.
  assert.deepEqual(startOptionFlags({}), [])
  assert.deepEqual(startOptionFlags({ autopilot: true, technical: false }), ['--autopilot', '--no-technical'])
  // Model (#628): maps to --model, trimmed; blank/whitespace is no choice -> no flag.
  assert.deepEqual(startOptionFlags({ model: 'opus' }), ['--model', 'opus'])
  assert.deepEqual(startOptionFlags({ model: '  sonnet  ' }), ['--model', 'sonnet'])
  assert.deepEqual(startOptionFlags({ model: '   ' }), [])
  // Agent (#650): only non-default codex emits --agent; claude is the CLI default -> no flag.
  assert.deepEqual(startOptionFlags({ agent: 'codex' }), ['--agent', 'codex'])
  assert.deepEqual(startOptionFlags({ agent: 'claude' }), [])
  assert.deepEqual(startOptionFlags({ agent: '   ' }), [])
  // Run target (#1050): only `actions` emits --run-on; `local` is the default -> no flag.
  assert.deepEqual(startOptionFlags({ target: 'actions' }), ['--run-on', 'actions'])
  assert.deepEqual(startOptionFlags({ target: 'local' }), [])
  // Unattended (#846): auto PM's own runs, whose gates must not park for an absent human.
  assert.deepEqual(startOptionFlags({ unattended: true }), ['--unattended'])
  assert.deepEqual(startOptionFlags({ unattended: false }), [])
  // Resume a finished run's session (#720): maps to --resume-session, trimmed; blank -> no flag.
  assert.deepEqual(startOptionFlags({ resumeSession: 'sess-42' }), ['--resume-session', 'sess-42'])
  assert.deepEqual(startOptionFlags({ resumeSession: '  sess-7  ' }), ['--resume-session', 'sess-7'])
  assert.deepEqual(startOptionFlags({ resumeSession: '   ' }), [])
})

const logEvent = (message: string): FrameworkEvent => ({ kind: 'log', message })
const line = (message: string): string => JSON.stringify(logEvent(message)) + '\n'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function tmpWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-daemon-'))
  await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
  return cwd
}

// The global daemon liveness now lives beside the registry (#393). Point it at a
// throwaway config dir under the workspace so tests never touch the real $HOME and
// clean up with the workspace. Returns the env the daemon fns resolve the path from.
async function configEnv(cwd: string): Promise<NodeJS.ProcessEnv> {
  const dir = join(cwd, 'cfg')
  await mkdir(dir, { recursive: true })
  return { XDG_CONFIG_HOME: dir }
}

test('EventTailer dispatches only events appended since the last pull', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, FRAMEWORK_DIR, EVENTS_FILE)
  try {
    const seen: string[] = []
    const tailer = new EventTailer(path, e => e.kind === 'log' && seen.push(e.message))

    await tailer.pull() // file absent -> no throw, nothing seen
    assert.deepEqual(seen, [])

    await writeFile(path, line('one') + line('two'))
    await tailer.pull()
    assert.deepEqual(seen, ['one', 'two'])

    await appendFile(path, line('three'))
    await tailer.pull()
    assert.deepEqual(seen, ['one', 'two', 'three']) // only the new line was re-read
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('EventTailer buffers a torn trailing line until its newline arrives', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, FRAMEWORK_DIR, EVENTS_FILE)
  try {
    const seen: string[] = []
    const tailer = new EventTailer(path, e => e.kind === 'log' && seen.push(e.message))

    const full = line('complete')
    await writeFile(path, full + '{"kind":"log","mess') // half a second line
    await tailer.pull()
    assert.deepEqual(seen, ['complete']) // the fragment is held back

    await appendFile(path, 'age":"rest"}\n')
    await tailer.pull()
    assert.deepEqual(seen, ['complete', 'rest'])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('EventTailer resets when the log is truncated by a fresh run', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, FRAMEWORK_DIR, EVENTS_FILE)
  try {
    const seen: string[] = []
    const tailer = new EventTailer(path, e => e.kind === 'log' && seen.push(e.message))

    await writeFile(path, line('old-run'))
    await tailer.pull()
    assert.deepEqual(seen, ['old-run'])

    // Truncate + rewrite to the SAME byte length (both lines are 35 bytes), so this is
    // caught by the mtime check, not by the shrink check.
    await sleep(20) // let mtime advance past the read above
    await writeFile(path, line('new-run'))
    await tailer.pull()
    assert.deepEqual(seen, ['old-run', 'new-run'])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('isProcessAlive is true for this process and false for a dead pid', () => {
  assert.equal(isProcessAlive(process.pid), true)
  assert.equal(isProcessAlive(2 ** 31 - 1), false) // an impossibly high, unused pid
})

test('readDaemonState returns undefined when absent or malformed', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  try {
    assert.equal(await readDaemonState(env), undefined) // absent
    await writeFile(daemonStatePath(env), 'not json')
    assert.equal(await readDaemonState(env), undefined) // malformed
    await writeFile(daemonStatePath(env), JSON.stringify({ pid: 1 })) // missing fields
    assert.equal(await readDaemonState(env), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

// #922: it used to delete the file here, so one check against a stale pid unregistered a
// daemon that was actually running, and nothing ever wrote the record back.
test('daemonStatus reports a stale state file as no daemon, without deleting it', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  try {
    const stale = { pid: 2 ** 31 - 1, port: 4477, url: 'http://127.0.0.1:4477', startedAt: '' }
    await writeFile(daemonStatePath(env), JSON.stringify(stale))
    assert.equal(await daemonStatus(env), undefined) // dead pid -> not running
    assert.deepEqual(await readDaemonState(env), stale) // ...and the read left the file alone
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('the state-file heartbeat rewrites a deleted record and yields to a live daemon', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  try {
    const mine = { pid: process.pid, port: 4478, url: 'http://127.0.0.1:4478', startedAt: '' }
    const heartbeat = startDaemonStateHeartbeat(mine, env, 60_000) // driven by hand, not by time
    await writeDaemonState(mine, env)

    await rm(daemonStatePath(env), { force: true })
    await heartbeat.beat()
    assert.deepEqual(await readDaemonState(env), mine) // a deletion heals

    // A record naming another *live* process belongs to that daemon; ours must not clobber it.
    const other = { pid: process.ppid, port: 4479, url: 'http://127.0.0.1:4479', startedAt: '' }
    await writeFile(daemonStatePath(env), JSON.stringify(other))
    await heartbeat.beat()
    assert.deepEqual(await readDaemonState(env), other)

    // A record naming a dead process is stale, so it is taken over.
    await writeFile(daemonStatePath(env), JSON.stringify({ ...other, pid: 2 ** 31 - 1 }))
    await heartbeat.beat()
    assert.deepEqual(await readDaemonState(env), mine)

    heartbeat.stop()
    await rm(daemonStatePath(env), { force: true })
    await heartbeat.beat()
    assert.equal(await readDaemonState(env), undefined) // stopped means stopped
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('stopDaemon reports false when nothing is running', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  try {
    assert.equal(await stopDaemon(env), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

// #514: stopDaemon must not return until the process is actually gone — the port is only
// free once it is, so an immediate restart would otherwise race it (EADDRINUSE -> "the
// daemon did not come up in time", with the old daemon still serving a stale bundle).
// This daemon ignores SIGTERM, standing in for a wedged shutdown: only the escalation ends it.
test('stopDaemon waits for the daemon to exit, escalating past an ignored SIGTERM (#514)', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  // Wait until it prints ready: before that its SIGTERM handler is not installed yet and the
  // default action would kill it, which would pass this test for the wrong reason.
  await new Promise<void>(resolvePromise => child.stdout!.once('data', () => resolvePromise()))
  try {
    await writeFile(
      daemonStatePath(env),
      JSON.stringify({ pid: child.pid, port: 4200, url: 'http://127.0.0.1:4200', startedAt: '2026-01-01T00:00:00.000Z' }),
    )
    assert.equal(await stopDaemon(env, { timeoutMs: 300 }), true)
    // The contract: once stopDaemon returns, the daemon is gone (so its port is free).
    assert.equal(isProcessAlive(child.pid!), false)
  } finally {
    try {
      child.kill('SIGKILL')
    } catch {
      // already reaped
    }
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon serves the dashboard, records its state, and cleans up on shutdown', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })

    // Wait for the daemon to bind and report itself.
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')
    assert.equal(state!.pid, process.pid)
    assert.match(state!.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    // The new Vike + Telefunc dashboard (its prerendered SPA shell) is served.
    const res = await fetch(state!.url)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /id="root"/)

    ac.abort()
    await done
    assert.equal(await readDaemonState(env), undefined) // state file removed on exit
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon comes up on a fresh workspace with no .the-framework yet', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-daemon-')) // deliberately no mkdir
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'the daemon created .the-framework/ itself and wrote its state file')
    assert.equal((await fetch(state!.url)).status, 200)
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('onServeTargets lists a monorepo\'s servable apps over telefunc (#651)', async () => {
  const cwd = await tmpWorkspace()
  // A monorepo whose root has no serve script; two workspace apps do, one package does not.
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'mono', scripts: { build: 'turbo build' } }))
  await writeFile(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n')
  await mkdir(join(cwd, 'apps', 'web'), { recursive: true })
  await writeFile(join(cwd, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }))
  await mkdir(join(cwd, 'apps', 'api'), { recursive: true })
  await writeFile(join(cwd, 'apps', 'api', 'package.json'), JSON.stringify({ name: 'api', scripts: { start: 'node .' } }))
  await mkdir(join(cwd, 'packages', 'lib'), { recursive: true })
  await writeFile(join(cwd, 'packages', 'lib', 'package.json'), JSON.stringify({ name: 'lib', scripts: { build: 'tsc' } }))
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')
    const targets = (await callTelefunc(state!.url, '/server/control.telefunc.ts', 'onServeTargets', [
      homeId(cwd),
    ])) as Array<{ id: string; label: string; script: string }>
    assert.deepEqual(
      targets.map(t => `${t.id}:${t.script}`),
      ['apps/api:start', 'apps/web:dev'],
      'lists only servable workspace apps, sorted; the non-servable package is excluded',
    )
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test("a session's Serve reads its own worktree, not the project's checkout (#797)", async () => {
  // The point of the change: Serve inside a session used to boot the project's tree, so you
  // pressed it on a session and got an app built from code that session never wrote. Here the
  // worktree has an app the project's checkout does not, so the two lists cannot be confused.
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'framework-daemon-serve-')))
  const git = nodeGitRunner()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    await git(['init'], cwd)
    await git(['config', 'user.email', 'test@example.com'], cwd)
    await git(['config', 'user.name', 'Test'], cwd)
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'root', scripts: { dev: 'vite' } }))
    await git(['add', '-A'], cwd)
    await git(['commit', '-m', 'init'], cwd)

    // A session's worktree, with a servable app that exists only on its branch.
    const runId = '2026-07-19T12-00-00-000Z'
    await addWorktree(cwd, { runId, branch: 'the-framework/session' })
    const worktree = join(cwd, FRAMEWORK_DIR, 'worktrees', runId)
    await writeFile(join(worktree, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n')
    await mkdir(join(worktree, 'apps', 'new-thing'), { recursive: true })
    await writeFile(
      join(worktree, 'apps', 'new-thing', 'package.json'),
      JSON.stringify({ name: 'new-thing', scripts: { dev: 'vite' } }),
    )

    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    const idsFor = async (runArg?: string): Promise<string[]> => {
      const targets = (await callTelefunc(state!.url, '/server/control.telefunc.ts', 'onServeTargets', [
        homeId(cwd),
        ...(runArg ? [runArg] : []),
      ])) as Array<{ id: string }>
      return targets.map(t => t.id).sort()
    }

    assert.deepEqual(await idsFor(), ['.'], "the project's checkout serves only its own root app")
    assert.deepEqual(
      await idsFor(runId),
      ['.', 'apps/new-thing'],
      "the session's checkout serves what its branch added",
    )
    // An unknown session falls back to the project rather than failing, like every other
    // run-addressed call.
    assert.deepEqual(await idsFor('2026-01-01T00-00-00-000Z'), ['.'])
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a git project starts concurrent runs, each in its own worktree (#736)', async () => {
  // realpath: on macOS tmpdir sits under the /var -> /private/var symlink, and git
  // reports the resolved path (same gotcha as the worktree module's own round-trip test).
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'framework-daemon-git-')))
  const git = nodeGitRunner()
  const ac = new AbortController()
  try {
    await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
    await git(['init'], cwd)
    await git(['config', 'user.email', 't@t'], cwd)
    await git(['config', 'user.name', 't'], cwd)
    await writeFile(join(cwd, 'README.md'), '# t\n')
    await git(['add', '-A'], cwd)
    await git(['commit', '-m', 'init'], cwd)

    // The stub logs to the *repo*, not to its own --cwd: each run now gets a different one.
    const stub = join(cwd, 'stub-cli.cjs')
    await writeFile(
      stub,
      `const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(join(cwd, 'started.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n')
setTimeout(() => {}, 800)
`,
    )
    const env = await configEnv(cwd)
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, binPath: stub, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    // The whole point of #736: the second Start is no longer refused as busy while the
    // first child is alive, because the two no longer share a working tree.
    const first = await sendStart(state!.url, cwd, 'a blog')
    const second = await sendStart(state!.url, cwd, 'another app')
    assert.equal(first.ok, true)
    assert.equal(second.ok, true, 'a concurrent run on the same project is allowed')

    let lines: string[] = []
    for (let i = 0; i < 100 && lines.length < 2; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = await readFile(join(cwd, 'started.log'), 'utf8').then(
        s => s.split('\n').filter(Boolean),
        () => [],
      )
    }
    assert.equal(lines.length, 2, 'both children spawned')

    const runs = lines.map(line => {
      const args = JSON.parse(line) as string[]
      return { cwd: args[args.indexOf('--cwd') + 1]!, runId: args[args.indexOf('--run-id') + 1]! }
    })
    for (const run of runs) {
      assert.equal(run.cwd, join(cwd, FRAMEWORK_DIR, 'worktrees', run.runId), 'ran in the worktree named by its run id')
      assert.equal((await stat(run.cwd)).isDirectory(), true, 'the worktree checkout exists')
      assert.equal((await stat(join(run.cwd, 'README.md'))).isFile(), true, 'with the repo content in it')
    }
    assert.notEqual(runs[0]!.cwd, runs[1]!.cwd, 'the two runs got different checkouts')

    // Each run is on its own `the-framework/run-<id>` branch, and the user's own checkout
    // was never moved off the branch it was sitting on.
    const branches = await git(['branch', '--format=%(refname:short)'], cwd)
    for (const run of runs) assert.ok(branches.includes(`the-framework/run-${run.runId}`), `branch for ${run.runId}`)
    const head = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
    assert.equal(head.startsWith('the-framework/run-'), false, 'the main checkout stayed on its own branch')

    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a finished run loses its worktree; a failed one keeps it, history saved either way (#737)', async () => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'framework-daemon-teardown-')))
  const git = nodeGitRunner()
  const ac = new AbortController()
  try {
    await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
    await git(['init'], cwd)
    await git(['config', 'user.email', 't@t'], cwd)
    await git(['config', 'user.name', 't'], cwd)
    await writeFile(join(cwd, 'README.md'), '# t\n')
    await git(['add', '-A'], cwd)
    await git(['commit', '-m', 'init'], cwd)

    // The stub plays a run: it writes the meta a real run would leave behind, with the status
    // read from a file the test controls, then exits so the daemon's teardown fires.
    const stub = join(cwd, 'stub-cli.cjs')
    await writeFile(
      stub,
      `const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
const runCwd = args[args.indexOf('--cwd') + 1]
const runId = args[args.indexOf('--run-id') + 1]
const status = fs.readFileSync(${JSON.stringify(join(cwd, 'status.txt'))}, 'utf8').trim()
const dir = path.join(runCwd, '.the-framework')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ kind: 'log', message: 'worked' }) + '\\n')
fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ version: 1, status, id: runId, startedAt: runId, updatedAt: runId, passes: 1 }))
fs.appendFileSync(${JSON.stringify(join(cwd, 'started.log'))}, runId + '\\n')
`,
    )
    const env = await configEnv(cwd)
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, binPath: stub, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    /** Start a run whose stub reports `status`, and resolve once its worktree has settled. */
    const runWith = async (status: string, nth: number): Promise<string> => {
      await writeFile(join(cwd, 'status.txt'), status)
      assert.equal((await sendStart(state!.url, cwd, `run ${status}`)).ok, true)
      let ids: string[] = []
      for (let i = 0; i < 150 && ids.length < nth; i++) {
        await new Promise(r => setTimeout(r, 20))
        ids = await readFile(join(cwd, 'started.log'), 'utf8').then(s => s.split('\n').filter(Boolean), () => [])
      }
      assert.equal(ids.length, nth, `run ${nth} started`)
      return ids[nth - 1]!
    }

    /** Poll for the archived history to appear, which is the teardown having run. */
    const archived = async (runId: string): Promise<boolean> => {
      for (let i = 0; i < 150; i++) {
        if (await stat(join(cwd, FRAMEWORK_DIR, 'runs', `${runId}.json`)).then(() => true, () => false)) return true
        await new Promise(r => setTimeout(r, 20))
      }
      return false
    }

    // A clean finish: history archived into the repo, worktree gone.
    const doneId = await runWith('done', 1)
    assert.equal(await archived(doneId), true, "a finished run's history is copied into the project")
    let gone = false
    for (let i = 0; i < 150 && !gone; i++) {
      gone = await stat(join(cwd, FRAMEWORK_DIR, 'worktrees', doneId)).then(() => false, () => true)
      if (!gone) await new Promise(r => setTimeout(r, 20))
    }
    assert.equal(gone, true, 'and its worktree is removed')
    // The branch is the only handle left on the work once the checkout goes, so it is recorded
    // while the worktree still exists (#799) — otherwise the handoff has nothing to read.
    const doneMeta = JSON.parse(
      await readFile(join(cwd, FRAMEWORK_DIR, 'runs', `${doneId}.json`), 'utf8'),
    ) as { branch?: string }
    assert.equal(doneMeta.branch, `the-framework/run-${doneId}`, "the finished run's branch is recorded")

    // A failure: history archived too, but the checkout is kept so it can be inspected.
    const failedId = await runWith('failed', 2)
    assert.equal(await archived(failedId), true, "a failed run's history is copied too")
    assert.equal(
      (await stat(join(cwd, FRAMEWORK_DIR, 'worktrees', failedId, 'README.md'))).isFile(),
      true,
      'and its worktree is retained, content and all, for inspection',
    )

    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('sendStart spawns the run child (prompt, --no-dashboard, --cwd) one at a time when the project has no worktree (#345)', async () => {
  // A non-git workspace cannot be given a worktree, so runs share the one checkout and the
  // pre-#736 one-at-a-time guard still applies. tmpWorkspace() is deliberately not a repo.
  const cwd = await tmpWorkspace()
  // A stub CLI standing in for the framework bin: it records its argv, then
  // stays alive briefly so the one-run-at-a-time guard has a window to trip.
  const stub = join(cwd, 'stub-cli.cjs')
  await writeFile(
    stub,
    `const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(args[args.indexOf('--cwd') + 1], 'started.log'), JSON.stringify(args) + '\\n')
setTimeout(() => {}, 600)
`,
  )
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, binPath: stub, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    const post = (prompt: string) => sendStart(state!.url, cwd, prompt)

    const first = await post('a blog')
    assert.equal(first.ok, true)

    // The child got the prompt as one word plus the headless + workspace flags.
    let lines: string[] = []
    for (let i = 0; i < 100 && lines.length < 1; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = await readFile(join(cwd, 'started.log'), 'utf8').then(
        s => s.split('\n').filter(Boolean),
        () => [],
      )
    }
    assert.deepEqual(JSON.parse(lines[0]!), ['a blog', '--no-dashboard', '--cwd', cwd])

    // While that child is alive, a second Start is refused (#322 runaway concern).
    const busy = await post('another app')
    assert.ok(busy.ok === false && busy.busy === true, 'a second start is refused as busy')

    // Once the child exits, the guard resets and Start works again.
    let again: StartResult = busy
    for (let i = 0; i < 100 && !again.ok; i++) {
      await new Promise(r => setTimeout(r, 50))
      again = await post('a second run')
    }
    assert.equal(again.ok, true)

    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('sendStart kind=research spawns the research subcommand, defaulting the what (#331)', async () => {
  const cwd = await tmpWorkspace()
  const stub = join(cwd, 'stub-cli.cjs')
  await writeFile(
    stub,
    `const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(args[args.indexOf('--cwd') + 1], 'started.log'), JSON.stringify(args) + '\\n')
`,
  )
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, binPath: stub, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    const post = (prompt: string, kind: string) => sendStart(state!.url, cwd, prompt, kind)

    // With a what -> it is passed through; without -> omitted so the CLI defaults it.
    assert.equal((await post('the auth flow', 'research')).ok, true)
    let lines: string[] = []
    for (let i = 0; i < 100 && lines.length < 1; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = await readFile(join(cwd, 'started.log'), 'utf8').then(
        s => s.split('\n').filter(Boolean),
        () => [],
      )
    }
    assert.deepEqual(JSON.parse(lines[0]!), ['research', 'the auth flow', '--no-dashboard', '--cwd', cwd])

    let second = await post('', 'research')
    for (let i = 0; i < 100 && !second.ok; i++) {
      await new Promise(r => setTimeout(r, 50))
      second = await post('', 'research')
    }
    assert.equal(second.ok, true)
    for (let i = 0; i < 100 && lines.length < 2; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = (await readFile(join(cwd, 'started.log'), 'utf8')).split('\n').filter(Boolean)
    }
    assert.deepEqual(JSON.parse(lines[1]!), ['research', '--no-dashboard', '--cwd', cwd])

    // kind=prompt (#353): a preset the user reviewed in the textarea runs verbatim
    // through the `prompt` subcommand, never re-rendered.
    const verbatim = 'Measure "problem variability" of this PR\n- List all high-level flows'
    let third = await post(verbatim, 'prompt')
    for (let i = 0; i < 100 && !third.ok; i++) {
      await new Promise(r => setTimeout(r, 50))
      third = await post(verbatim, 'prompt')
    }
    assert.equal(third.ok, true)
    for (let i = 0; i < 100 && lines.length < 3; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = (await readFile(join(cwd, 'started.log'), 'utf8')).split('\n').filter(Boolean)
    }
    assert.deepEqual(JSON.parse(lines[2]!), ['prompt', verbatim, '--no-dashboard', '--cwd', cwd])

    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('sendStart refuses to re-exec a test entry as the run (#345)', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  try {
    // No binPath: argv[1] here is this test file — the fork-bomb guard must trip.
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')
    const result = await sendStart(state!.url, cwd, 'a blog')
    assert.ok(result.ok === false && /test entry/.test(result.error), 'the fork-bomb guard refuses a test entry')
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon steers through the control log: sendStop / sendChoice append entries (#344)', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  const ac = new AbortController()
  // sendStop / sendChoice resolve the project through the registry the Telefunc layer reads
  // from `process.env` (not the daemon's injected `env`), so point the config dir there for
  // this test; restore it after. (sendStart uses the daemon's own homeId shortcut instead.)
  const prevXdg = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = env['XDG_CONFIG_HOME']
  try {
    const done = runDaemon(cwd, { port: 0, signal: ac.signal, env })
    let state = await readDaemonState(env)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(env)
    }
    assert.ok(state, 'daemon wrote its state file')

    // The dashboard steers over Telefunc: sendStop / sendChoice append to control.jsonl.
    const id = homeId(cwd)
    await callTelefunc(state!.url, '/server/control.telefunc.ts', 'sendStop', [id])
    await callTelefunc(state!.url, '/server/control.telefunc.ts', 'sendChoice', [id, 'plan-approval', 'alt:0', 'user'])

    // Both landed in the control log (appends are async fire-and-forget: poll).
    let lines: string[] = []
    for (let i = 0; i < 100 && lines.length < 2; i++) {
      await new Promise(r => setTimeout(r, 20))
      lines = await readFile(controlPath(cwd), 'utf8').then(
        s => s.split('\n').filter(Boolean),
        () => [],
      )
    }
    assert.deepEqual(lines.map(l => JSON.parse(l)), [
      { kind: 'stop' },
      { kind: 'choice', id: 'plan-approval', pick: 'alt:0', by: 'user' },
    ])

    ac.abort()
    await done
  } finally {
    ac.abort()
    if (prevXdg === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = prevXdg
    await rm(cwd, { recursive: true, force: true })
  }
})

test('isNestedWithin flags a child path, not equal/sibling/parent (#647)', () => {
  assert.equal(isNestedWithin('/repo/packages/framework', '/repo'), true)
  assert.equal(isNestedWithin('/repo', '/repo'), false) // equal is not nested
  assert.equal(isNestedWithin('/repo', '/repo/packages'), false) // parent is not nested
  assert.equal(isNestedWithin('/other/framework', '/repo'), false) // sibling tree
  assert.equal(isNestedWithin('/repo-x', '/repo'), false) // prefix but not a path child
})

test('registerHomeProject skips a cwd nested inside an already-tracked project (#647)', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'framework-parent-'))
  const env = await configEnv(parent)
  try {
    await addProject(parent, new Date().toISOString(), undefined, env)
    // A nested, activated subfolder (like packages/framework inside the repo).
    const nested = join(parent, 'packages', 'framework')
    await mkdir(join(nested, FRAMEWORK_DIR), { recursive: true })

    await registerHomeProject(nested, env)

    const projects = await listProjects(undefined, env)
    assert.deepEqual(
      projects.map(p => p.path),
      [parent],
      'the nested subfolder must not be added as a second project',
    )
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('registerHomeProject still adds an activated cwd that is not nested (#647)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'framework-home-'))
  const env = await configEnv(home)
  try {
    await mkdir(join(home, FRAMEWORK_DIR), { recursive: true })
    await registerHomeProject(home, env)
    const projects = await listProjects(undefined, env)
    assert.deepEqual(projects.map(p => p.path), [home])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
