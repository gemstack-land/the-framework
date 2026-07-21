import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { LocalRunner } from './local.js'
import { RunnerError } from './types.js'

/** Grab an ephemeral free port so the boot-and-serve tests don't collide in CI. */
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

const httpServer = (port: number, body: string): string =>
  `const http=require('http');http.createServer((_,res)=>{res.writeHead(200);res.end(${JSON.stringify(body)})}).listen(${port},'127.0.0.1')`

describe('LocalRunner.boot', () => {
  it('seeds a real workspace with files, including nested paths', async () => {
    const s = await new LocalRunner().boot({ files: { './pages/+Page.jsx': 'PAGE', 'app.ts': 'APP' } })
    try {
      assert.equal(await s.fs.read('pages/+Page.jsx'), 'PAGE')
      assert.equal(await s.fs.read('/app.ts'), 'APP') // leading slash normalized
      assert.ok(existsSync(s.root))
    } finally {
      await s.dispose()
    }
  })

  it('gives each session a distinct id and workspace', async () => {
    const runner = new LocalRunner()
    const a = await runner.boot()
    const b = await runner.boot()
    try {
      assert.notEqual(a.id, b.id)
      assert.notEqual(a.root, b.root)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })
})

describe('LocalRunnerSession.fs', () => {
  it('writes, reads, checks existence, lists recursively, and removes', async () => {
    const s = await new LocalRunner().boot()
    try {
      assert.equal(await s.fs.exists('a.txt'), false)
      await s.fs.write('src/a.txt', 'A')
      await s.fs.write('src/b.txt', 'B')
      await s.fs.write('root.txt', 'R')
      assert.equal(await s.fs.exists('src/a.txt'), true)
      assert.deepEqual(await s.fs.list('src'), ['src/a.txt', 'src/b.txt'])
      assert.deepEqual(await s.fs.list(), ['root.txt', 'src/a.txt', 'src/b.txt'])
      await s.fs.remove('src/a.txt')
      assert.equal(await s.fs.exists('src/a.txt'), false)
    } finally {
      await s.dispose()
    }
  })

  it('throws reading a missing file', async () => {
    const s = await new LocalRunner().boot()
    try {
      await assert.rejects(() => s.fs.read('nope.txt'), RunnerError)
    } finally {
      await s.dispose()
    }
  })

  it('refuses paths that escape the workspace', async () => {
    const s = await new LocalRunner().boot()
    try {
      await assert.rejects(() => s.fs.read('../../etc/passwd'), RunnerError)
      await assert.rejects(() => s.fs.write('../evil.txt', 'x'), RunnerError)
    } finally {
      await s.dispose()
    }
  })
})

describe('LocalRunnerSession.exec', () => {
  it('runs a real command and captures stdout + exit code', async () => {
    const s = await new LocalRunner().boot({ files: { 'app.js': "process.stdout.write('hi')" } })
    try {
      const r = await s.exec('node app.js')
      assert.equal(r.stdout, 'hi')
      assert.equal(r.exitCode, 0)
    } finally {
      await s.dispose()
    }
  })

  it('reports a non-zero exit code', async () => {
    const s = await new LocalRunner().boot()
    try {
      const r = await s.exec('node -e "process.exit(3)"')
      assert.equal(r.exitCode, 3)
    } finally {
      await s.dispose()
    }
  })

  it('honors cwd and env overrides', async () => {
    const s = await new LocalRunner().boot({ files: { 'sub/probe.js': 'process.stdout.write(process.env.FOO || "")' } })
    try {
      const r = await s.exec('node probe.js', { cwd: 'sub', env: { FOO: 'bar' } })
      assert.equal(r.stdout, 'bar')
    } finally {
      await s.dispose()
    }
  })

  it('kills a command that exceeds its timeout', async () => {
    const s = await new LocalRunner().boot()
    try {
      const r = await s.exec('node -e "setTimeout(()=>{}, 10000)"', { timeoutMs: 200 })
      assert.equal(r.exitCode, 124)
      assert.match(r.stderr, /timed out/)
    } finally {
      await s.dispose()
    }
  })

  it('times out even when a background grandchild outlives the shell', async () => {
    const s = await new LocalRunner().boot()
    try {
      // The grandchild survives a kill aimed at `sh` alone and holds the inherited
      // stdio open, so `close` never fires — the timeout must still bound the call.
      const started = Date.now()
      const r = await s.exec('node -e "setTimeout(()=>{}, 10000)" & sleep 10', { timeoutMs: 300 })
      assert.equal(r.exitCode, 124)
      assert.ok(Date.now() - started < 5000, `exec took ${Date.now() - started}ms — the timeout did not bound it`)
    } finally {
      await s.dispose()
    }
  })
})

describe('LocalRunnerSession.preview', () => {
  it('returns a localhost url on the requested port when supported', async () => {
    const s = await new LocalRunner({ previewHost: 'http://127.0.0.1' }).boot()
    try {
      assert.equal(typeof s.preview, 'function')
      assert.deepEqual(await s.preview!({ port: 5173 }), { url: 'http://127.0.0.1:5173', port: 5173 })
      assert.equal((await s.preview!()).port, 3000) // default port
    } finally {
      await s.dispose()
    }
  })

  it('omits the preview method when previews are disabled', async () => {
    const s = await new LocalRunner({ preview: false }).boot()
    try {
      assert.equal(s.preview, undefined)
    } finally {
      await s.dispose()
    }
  })
})

describe('LocalRunnerSession.dispose', () => {
  it('removes the workspace and blocks further exec/preview (idempotent)', async () => {
    const s = await new LocalRunner().boot({ files: { 'a.txt': 'A' } })
    const root = s.root
    assert.ok(existsSync(root))
    await s.dispose()
    assert.equal(s.disposed, true)
    assert.equal(existsSync(root), false)
    await s.dispose() // idempotent
    await assert.rejects(() => s.exec('ls'), RunnerError)
    await assert.rejects(() => s.preview!(), RunnerError)
  })
})

describe('LocalRunnerSession.start (boot and serve)', () => {
  it('runs a real background server that preview can reach, then stop kills it', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': httpServer(port, 'hello from runner') } })
    try {
      const proc = await s.start('node server.js')
      assert.equal(proc.command, 'node server.js')

      const preview = await s.preview!({ port, waitMs: 5000 })
      assert.equal(preview.port, port)

      const res = await fetch(preview.url)
      assert.equal(await res.text(), 'hello from runner') // the app is actually serving

      await proc.stop()
      await assert.rejects(fetch(preview.url)) // port no longer listening
    } finally {
      await s.dispose()
    }
  })

  it('start does not block on a long-running process', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': httpServer(port, 'x') } })
    try {
      // Would hang forever with exec(); start() must resolve immediately.
      const proc = await s.start('node server.js')
      let exited = false
      void proc.exit.then(() => (exited = true))
      assert.equal(exited, false) // still running right after start
      await proc.stop()
    } finally {
      await s.dispose()
    }
  })

  it('dispose stops a still-running process', async () => {
    const port = await freePort()
    const s = await new LocalRunner().boot({ files: { 'server.js': httpServer(port, 'x') } })
    const proc = await s.start('node server.js')
    await s.preview!({ port, waitMs: 5000 })
    await s.dispose()
    const result = await proc.exit // resolves because dispose stopped it
    assert.notEqual(result.exitCode, 0) // killed, not a clean exit
  })
})

describe('LocalRunner.adopt', () => {
  it('runs inside an existing directory and does NOT delete it on dispose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    try {
      await writeFile(join(dir, 'greeting.txt'), 'hello from an existing dir')
      const s = await new LocalRunner().adopt(dir)
      assert.equal(await s.fs.read('greeting.txt'), 'hello from an existing dir')
      const { stdout } = await s.exec('node -e "process.stdout.write(String(1+1))"')
      assert.equal(stdout, '2')
      await s.dispose()
      assert.equal(existsSync(dir), true) // the caller's directory survives dispose
      assert.equal(existsSync(join(dir, 'greeting.txt')), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes seed files into the adopted directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    try {
      const s = await new LocalRunner().adopt(dir, { files: { 'pkg/config.json': '{"ok":true}' } })
      assert.equal(await s.fs.read('pkg/config.json'), '{"ok":true}')
      await s.dispose()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
