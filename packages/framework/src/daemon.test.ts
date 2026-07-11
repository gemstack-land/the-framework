import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, appendFile, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FrameworkEvent } from './events.js'
import {
  EventTailer,
  readDaemonState,
  isProcessAlive,
  daemonStatus,
  stopDaemon,
  runDaemon,
  daemonStatePath,
} from './daemon.js'
import { EVENTS_FILE, FRAMEWORK_DIR } from './store/index.js'
import { controlPath } from './control.js'

const logEvent = (message: string): FrameworkEvent => ({ kind: 'log', message })
const line = (message: string): string => JSON.stringify(logEvent(message)) + '\n'

async function tmpWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-daemon-'))
  await mkdir(join(cwd, FRAMEWORK_DIR), { recursive: true })
  return cwd
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

    await writeFile(path, line('new-run')) // truncate + rewrite (shorter than offset)
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
  try {
    assert.equal(await readDaemonState(cwd), undefined) // absent
    await writeFile(daemonStatePath(cwd), 'not json')
    assert.equal(await readDaemonState(cwd), undefined) // malformed
    await writeFile(daemonStatePath(cwd), JSON.stringify({ pid: 1 })) // missing fields
    assert.equal(await readDaemonState(cwd), undefined)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('daemonStatus removes a stale state file whose process is gone', async () => {
  const cwd = await tmpWorkspace()
  try {
    await writeFile(
      daemonStatePath(cwd),
      JSON.stringify({ pid: 2 ** 31 - 1, port: 4477, url: 'http://127.0.0.1:4477', startedAt: '' }),
    )
    assert.equal(await daemonStatus(cwd), undefined) // dead pid -> not running
    assert.equal(await readDaemonState(cwd), undefined) // ...and the stale file is cleaned up
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('stopDaemon reports false when nothing is running', async () => {
  const cwd = await tmpWorkspace()
  try {
    assert.equal(await stopDaemon(cwd), false)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon serves the dashboard, records its state, and cleans up on shutdown', async () => {
  const cwd = await tmpWorkspace()
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, pollMs: 50, signal: ac.signal })

    // Wait for the daemon to bind and report itself.
    let state = await readDaemonState(cwd)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(cwd)
    }
    assert.ok(state, 'daemon wrote its state file')
    assert.equal(state!.pid, process.pid)
    assert.match(state!.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    // The dashboard page is served.
    const res = await fetch(state!.url)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /The Framework/)

    ac.abort()
    await done
    assert.equal(await readDaemonState(cwd), undefined) // state file removed on exit
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon comes up on a fresh workspace with no .framework yet', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'framework-daemon-')) // deliberately no mkdir
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, pollMs: 50, signal: ac.signal })
    let state = await readDaemonState(cwd)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(cwd)
    }
    assert.ok(state, 'the daemon created .framework/ itself and wrote its state file')
    assert.equal((await fetch(state!.url)).status, 200)
    ac.abort()
    await done
  } finally {
    ac.abort()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runDaemon steers through the control log: /stop and /choice POSTs append entries (#344)', async () => {
  const cwd = await tmpWorkspace()
  const ac = new AbortController()
  try {
    const done = runDaemon(cwd, { port: 0, pollMs: 50, signal: ac.signal })
    let state = await readDaemonState(cwd)
    for (let i = 0; i < 100 && !state; i++) {
      await new Promise(r => setTimeout(r, 20))
      state = await readDaemonState(cwd)
    }
    assert.ok(state, 'daemon wrote its state file')

    // The daemon page has steering wired: the Stop button shows and /choice accepts.
    const stop = await fetch(`${state!.url}/stop`, { method: 'POST' })
    assert.equal(stop.status, 202)
    const choice = await fetch(`${state!.url}/choice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'plan-approval', pick: 'alt:0', by: 'user' }),
    })
    assert.equal(choice.status, 202)

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
    await rm(cwd, { recursive: true, force: true })
  }
})
