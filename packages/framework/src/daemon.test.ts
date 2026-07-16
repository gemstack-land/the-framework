import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, appendFile, rm, mkdir, readFile } from 'node:fs/promises'
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
  startOptionFlags,
} from './daemon.js'
import { EVENTS_FILE, FRAMEWORK_DIR } from './store/index.js'
import { controlPath } from './control.js'
import { projectId } from './registry.js'

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
  // Post-merge prompt (#326): maps to --post-merge.
  assert.deepEqual(startOptionFlags({ postMerge: true }), ['--post-merge'])
  // Browser via chrome-devtools-mcp (#452): maps to --browser.
  assert.deepEqual(startOptionFlags({ browser: true }), ['--browser'])
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

test('daemonStatus removes a stale state file whose process is gone', async () => {
  const cwd = await tmpWorkspace()
  const env = await configEnv(cwd)
  try {
    await writeFile(
      daemonStatePath(env),
      JSON.stringify({ pid: 2 ** 31 - 1, port: 4477, url: 'http://127.0.0.1:4477', startedAt: '' }),
    )
    assert.equal(await daemonStatus(env), undefined) // dead pid -> not running
    assert.equal(await readDaemonState(env), undefined) // ...and the stale file is cleaned up
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

test('sendStart spawns the run child (prompt, --no-dashboard, --cwd) one at a time (#345)', async () => {
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
