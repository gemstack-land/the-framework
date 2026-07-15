import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { serveCheck, mergeChecklists } from './serve-check.js'
import { LocalRunner } from '../runner/local.js'
import { FakeRunner } from '../runner/fake.js'
import type { LoopPassContext } from './types.js'
import type { Verdict } from '../loop/verdict.js'

/** A minimal loop-pass context — serveCheck ignores it, but the contract needs one. */
const ctx: LoopPassContext = { pass: 1, intent: '', blockers: [] }

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

const server = (port: number, status: number, body: string): string =>
  `const http=require('http');http.createServer((_,res)=>{res.writeHead(${status});res.end(${JSON.stringify(body)})}).listen(${port},'127.0.0.1')`

describe('serveCheck (boots and serves the app)', () => {
  it('passes with no blockers when the app boots and serves', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': server(port, 200, 'ok') } })
    try {
      const verdict = await serveCheck(s, { serve: 'node server.js', port, waitMs: 5000 })(ctx)
      assert.deepEqual(verdict.blockers, [])
    } finally {
      await s.dispose()
    }
  })

  it('blocks when the app serves a server error', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': server(port, 500, 'boom') } })
    try {
      const verdict = await serveCheck(s, { serve: 'node server.js', port, waitMs: 5000 })(ctx)
      assert.equal(verdict.blockers.length, 1)
      assert.match(verdict.blockers[0]!, /responded 500/)
    } finally {
      await s.dispose()
    }
  })

  it('blocks when the dev server exits before serving', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': 'process.exit(1)' } })
    try {
      const verdict = await serveCheck(s, { serve: 'node server.js', port, waitMs: 1000 })(ctx)
      assert.equal(verdict.blockers.length, 1)
      assert.match(verdict.blockers[0]!, /exited before serving/)
    } finally {
      await s.dispose()
    }
  })

  it('blocks on a failed install and never starts the server', async () => {
    const runner = new FakeRunner({
      onExec: cmd => (cmd.includes('install') ? { stdout: '', stderr: 'ERESOLVE', exitCode: 1 } : { stdout: '', stderr: '', exitCode: 0 }),
    })
    const s = await runner.boot()
    const verdict = await serveCheck(s, { install: 'npm install', serve: 'npm run dev' })(ctx)
    assert.equal(verdict.blockers.length, 1)
    assert.match(verdict.blockers[0]!, /install failed/)
    assert.equal(s.startCalls.length, 0) // never got as far as starting
  })

  it('skips (passing, with a note) when the runner cannot serve a preview', async () => {
    const s = await new FakeRunner({ background: false }).boot()
    const verdict = await serveCheck(s, { serve: 'npm run dev' })(ctx)
    assert.deepEqual(verdict.blockers, [])
    assert.match(verdict.notes!, /skipped/)
  })
})

describe('mergeChecklists', () => {
  it('unions and dedupes the blockers of every check', async () => {
    const a = async (): Promise<Verdict> => ({ blockers: ['no auth', 'slow query'] })
    const b = async (): Promise<Verdict> => ({ blockers: ['slow query', 'missing tests'], notes: 'serve ok' })
    const verdict = await mergeChecklists(a, b)(ctx)
    assert.deepEqual([...verdict.blockers].sort(), ['missing tests', 'no auth', 'slow query'])
    assert.equal(verdict.notes, 'serve ok')
  })

  it('passes only when every check is clean', async () => {
    const clean = async (): Promise<Verdict> => ({ blockers: [] })
    const dirty = async (): Promise<Verdict> => ({ blockers: ['boom'] })
    assert.deepEqual((await mergeChecklists(clean, clean)(ctx)).blockers, [])
    assert.deepEqual((await mergeChecklists(clean, dirty)(ctx)).blockers, ['boom'])
  })
})
