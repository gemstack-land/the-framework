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
    const { result } = await runFramework({
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
