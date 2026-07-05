import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { FakeDriver } from './driver/index.js'
import { runFramework } from './run.js'
import { FAKE_SIGNALS } from './fake-script.js'
import type { FrameworkEvent } from './events.js'
import { FakeRunner, dockerAvailable } from '@gemstack/ai-autopilot'

/** An ephemeral free port so parallel test runs do not collide. */
function freePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const srv = createServer()
    srv.on('error', rejectPromise)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolvePromise(port))
    })
  })
}

const CLEAN_REVIEW = [
  { text: '```json\n{"stack":"Node HTTP","narration":"n","decisions":[]}\n```' },
  { text: 'built the app' },
  { text: 'reviewed\n```json\n{"blockers":[]}\n```' },
]

test('serve gate: production-grade only when the agent review AND the real server pass', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-serve-'))
  const port = await freePort()
  try {
    // The "app the agent built": a tiny server that boots on `port`.
    await writeFile(join(dir, 'server.js'), `require('http').createServer((_,res)=>res.end('ok')).listen(${port})\n`)
    const events: FrameworkEvent[] = []
    const { result, preview } = await runFramework({
      intent: 'a tiny http service',
      driver: new FakeDriver({ turns: CLEAN_REVIEW }),
      cwd: dir,
      signals: FAKE_SIGNALS,
      serve: { command: 'node server.js', port, waitMs: 5000 },
      onEvent: e => events.push(e),
    })
    assert.equal(result.productionGrade, true)
    assert.equal(result.passes, 1)
    assert.ok(events.some(e => e.kind === 'log' && e.message.startsWith('serve:')))
    // Without keepAlive the app is torn down after the check: no lingering handle.
    assert.equal(preview, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('serve gate: the app is left running with a preview link after a successful run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-serve-'))
  const port = await freePort()
  try {
    await writeFile(join(dir, 'server.js'), `require('http').createServer((_,res)=>res.end('hi from app')).listen(${port})\n`)
    const events: FrameworkEvent[] = []
    const { result, preview } = await runFramework({
      intent: 'a tiny http service',
      driver: new FakeDriver({ turns: CLEAN_REVIEW }),
      cwd: dir,
      signals: FAKE_SIGNALS,
      serve: { command: 'node server.js', port, waitMs: 5000, keepAlive: true },
      onEvent: e => events.push(e),
    })
    assert.equal(result.productionGrade, true)

    // The app is handed back running, with a preview event on the stream.
    assert.ok(preview, 'expected a live preview')
    assert.equal(preview!.url, `http://localhost:${port}`)
    assert.ok(events.some(e => e.kind === 'preview' && e.url === preview!.url))

    // It actually serves right now.
    const res = await fetch(preview!.url)
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'hi from app')

    // stop() tears it down; the port stops answering.
    await preview!.stop()
    await assert.rejects(fetch(preview!.url))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('serve gate: an injected runner is used as-is, bypassing sandbox provisioning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-serve-'))
  try {
    await writeFile(join(dir, 'server.js'), `require('http').createServer((_,res)=>res.end('ok')).listen(3000)\n`)
    const runner = await new FakeRunner().boot({ files: {} })
    const events: FrameworkEvent[] = []
    // sandbox:'docker' is set, but the injected runner wins: no container is booted
    // and no host→container sync runs. The serve check runs on the injected runner.
    await runFramework({
      intent: 'a tiny http service',
      driver: new FakeDriver({ turns: CLEAN_REVIEW }),
      cwd: dir,
      signals: FAKE_SIGNALS,
      maxPasses: 1,
      sandbox: 'docker',
      runner,
      serve: { command: 'node server.js', port: 3000, waitMs: 500 },
      onEvent: e => events.push(e),
    })
    // The serve command started on the injected runner — it was used, not provisioned away.
    assert.ok(runner.startCalls.some(c => c.command === 'node server.js'))
    // Provisioning was bypassed: no container-boot log, no sync log.
    assert.ok(!events.some(e => e.kind === 'log' && e.message.includes('Docker container')))
    assert.ok(!events.some(e => e.kind === 'log' && e.message.includes('synced')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Real Docker end-to-end: install-free tiny server, booted and served inside a
// throwaway container. Skips when Docker is not reachable (so CI without a daemon
// stays green); the local dev machine with a daemon exercises the real path.
test('serve gate (docker sandbox): boots and serves the app inside a container', async t => {
  if (!(await dockerAvailable())) {
    t.skip('docker not available')
    return
  }
  const dir = await mkdtemp(join(tmpdir(), 'fw-serve-'))
  try {
    // Listens on the container-internal port (3000); Docker maps it to a host port.
    await writeFile(join(dir, 'server.js'), `require('http').createServer((_,res)=>res.end('served in docker')).listen(3000)\n`)
    const events: FrameworkEvent[] = []
    const { result } = await runFramework({
      intent: 'a tiny http service',
      driver: new FakeDriver({ turns: CLEAN_REVIEW }),
      cwd: dir,
      signals: FAKE_SIGNALS,
      maxPasses: 1,
      sandbox: 'docker',
      serve: { command: 'node server.js', port: 3000, waitMs: 20_000 },
      onEvent: e => events.push(e),
    })
    assert.equal(result.productionGrade, true)
    assert.ok(events.some(e => e.kind === 'log' && e.message.includes('Docker container')))
    assert.ok(events.some(e => e.kind === 'log' && e.message.includes('synced')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('serve gate: a server that never boots blocks, even when the agent review is clean', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-serve-'))
  const port = await freePort()
  try {
    // A "server" that exits immediately, so nothing ever serves.
    await writeFile(join(dir, 'server.js'), `process.exit(0)\n`)
    const { result } = await runFramework({
      intent: 'a broken service',
      driver: new FakeDriver({ turns: CLEAN_REVIEW }),
      cwd: dir,
      signals: FAKE_SIGNALS,
      maxPasses: 1,
      serve: { command: 'node server.js', port, waitMs: 1500 },
    })
    assert.equal(result.productionGrade, false)
    assert.ok(result.blockers.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
