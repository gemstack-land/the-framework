import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serveCheck } from './serve-check.js'
import { DockerRunner, dockerAvailable } from '../runner/docker.js'
import type { LoopPassContext } from './types.js'

/**
 * The sandboxed boot-and-serve proof. `serveCheck` is exercised end-to-end
 * against a REAL container: it installs, `start`s a dev server, `preview`s it
 * (readiness probed inside the container), and fetches a health path — the same
 * production-grade check the full-fledged loop runs, now through the `DockerRunner`
 * sandbox instead of the host. Skips cleanly when no daemon is reachable.
 */
const skip = (await dockerAvailable()) ? false : 'no docker daemon available'

/** A minimal loop-pass context — serveCheck ignores it, but the contract needs one. */
const ctx: LoopPassContext = { pass: 1, intent: '', blockers: [] }

/** A server bound to 0.0.0.0 so the container's published port reaches it from the host. */
const server = (port: number, status: number, body: string): string =>
  `const http=require('http');http.createServer((_,res)=>{res.writeHead(${status});res.end(${JSON.stringify(body)})}).listen(${port},'0.0.0.0')`

const pkg = JSON.stringify({ name: 'sandbox-app', private: true }) + '\n'

// DockerRunner publishes previewPort 3000 at boot; the app and serveCheck both default to 3000.
const PORT = 3000

describe('serveCheck × DockerRunner (sandboxed boot-and-serve)', { skip }, () => {
  it('installs, serves, and fetches a healthy app inside a real container', async () => {
    const s = await new DockerRunner().boot({
      files: { 'package.json': pkg, 'server.js': server(PORT, 200, 'ok') },
    })
    try {
      // A real `npm install` (no deps → fast) proves the install prerequisite runs in the sandbox.
      const verdict = await serveCheck(s, { install: 'npm install', serve: 'node server.js', healthPath: '/health' })(ctx)
      assert.deepEqual(verdict.blockers, [])
    } finally {
      await s.dispose()
    }
  })

  it('flags a server error (5xx) as a blocker', async () => {
    const s = await new DockerRunner().boot({ files: { 'server.js': server(PORT, 500, 'boom') } })
    try {
      const verdict = await serveCheck(s, { serve: 'node server.js' })(ctx)
      assert.equal(verdict.blockers.length, 1)
      assert.match(verdict.blockers[0]!, /responded 500/)
    } finally {
      await s.dispose()
    }
  })

  it('flags a server that exits before serving as a blocker', async () => {
    const s = await new DockerRunner().boot({ files: { 'boot.js': 'process.exit(1)' } })
    try {
      const verdict = await serveCheck(s, { serve: 'node boot.js', waitMs: 3000 })(ctx)
      assert.equal(verdict.blockers.length, 1)
      assert.match(verdict.blockers[0]!, /exited before serving/)
    } finally {
      await s.dispose()
    }
  })

  it('flags a failing install as a blocker before anything is served', async () => {
    const s = await new DockerRunner().boot({ files: { 'server.js': server(PORT, 200, 'ok') } })
    try {
      const verdict = await serveCheck(s, { install: 'exit 3', serve: 'node server.js' })(ctx)
      assert.equal(verdict.blockers.length, 1)
      assert.match(verdict.blockers[0]!, /install failed/)
    } finally {
      await s.dispose()
    }
  })
})
