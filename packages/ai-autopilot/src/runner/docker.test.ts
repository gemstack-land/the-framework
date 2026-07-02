import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { DockerRunner, dockerAvailable } from './docker.js'
import { RunnerError } from './types.js'

// Real containers need a daemon; skip the whole suite (green) when one isn't reachable.
const skip = (await dockerAvailable()) ? false : 'no docker daemon available'

/** A server bound to 0.0.0.0 so Docker's published port can reach it from the host. */
const httpServer = (port: number, body: string): string =>
  `const http=require('http');http.createServer((_,res)=>{res.writeHead(200);res.end(${JSON.stringify(body)})}).listen(${port},'0.0.0.0')`

describe('DockerRunner.boot', { skip }, () => {
  it('seeds a container workspace with files, including nested paths', async () => {
    const s = await new DockerRunner().boot({ files: { './pages/+Page.jsx': 'PAGE', 'app.ts': 'APP' } })
    try {
      assert.equal(await s.fs.read('pages/+Page.jsx'), 'PAGE')
      assert.equal(await s.fs.read('/app.ts'), 'APP') // leading slash normalized
    } finally {
      await s.dispose()
    }
  })

  it('gives each session a distinct id and container', async () => {
    const runner = new DockerRunner()
    const a = await runner.boot()
    const b = await runner.boot()
    try {
      assert.notEqual(a.id, b.id)
      assert.notEqual(a.container, b.container)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })
})

describe('DockerRunnerSession.fs', { skip }, () => {
  it('writes, reads, checks existence, lists recursively, and removes', async () => {
    const s = await new DockerRunner().boot()
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
    const s = await new DockerRunner().boot()
    try {
      await assert.rejects(() => s.fs.read('nope.txt'), RunnerError)
    } finally {
      await s.dispose()
    }
  })

  it('refuses paths that escape the workspace', async () => {
    const s = await new DockerRunner().boot()
    try {
      await assert.rejects(() => s.fs.read('../../etc/passwd'), RunnerError)
      await assert.rejects(() => s.fs.write('../evil.txt', 'x'), RunnerError)
    } finally {
      await s.dispose()
    }
  })
})

describe('DockerRunnerSession.exec', { skip }, () => {
  it('runs a real command inside the container and captures stdout + exit code', async () => {
    const s = await new DockerRunner().boot({ files: { 'app.js': "process.stdout.write('hi')" } })
    try {
      const r = await s.exec('node app.js')
      assert.equal(r.stdout, 'hi')
      assert.equal(r.exitCode, 0)
    } finally {
      await s.dispose()
    }
  })

  it('reports a non-zero exit code', async () => {
    const s = await new DockerRunner().boot()
    try {
      assert.equal((await s.exec('node -e "process.exit(3)"')).exitCode, 3)
    } finally {
      await s.dispose()
    }
  })

  it('honors cwd and env overrides', async () => {
    const s = await new DockerRunner().boot({ files: { 'sub/probe.js': 'process.stdout.write(process.env.FOO||"")' } })
    try {
      const r = await s.exec('node probe.js', { cwd: 'sub', env: { FOO: 'bar' } })
      assert.equal(r.stdout, 'bar')
    } finally {
      await s.dispose()
    }
  })

  it('runs isolated from the host filesystem', async () => {
    const s = await new DockerRunner().boot()
    try {
      // The workspace is empty inside the container no matter what sits in the host cwd.
      assert.deepEqual(await s.fs.list(), [])
      assert.equal((await s.exec('ls package.json 2>/dev/null; true')).stdout.trim(), '')
    } finally {
      await s.dispose()
    }
  })

  it('kills a command that exceeds its timeout', async () => {
    const s = await new DockerRunner().boot()
    try {
      const r = await s.exec('node -e "setTimeout(()=>{},10000)"', { timeoutMs: 1000 })
      assert.equal(r.exitCode, 124)
      assert.match(r.stderr, /timed out/)
    } finally {
      await s.dispose()
    }
  })
})

describe('DockerRunnerSession.preview', { skip }, () => {
  it('omits the preview method when previews are disabled', async () => {
    const s = await new DockerRunner({ preview: false }).boot()
    try {
      assert.equal(s.preview, undefined)
    } finally {
      await s.dispose()
    }
  })

  it('rejects a port that was not published at boot', async () => {
    const s = await new DockerRunner().boot() // publishes previewPort 3000
    try {
      await assert.rejects(() => s.preview!({ port: 9999 }), RunnerError)
    } finally {
      await s.dispose()
    }
  })
})

describe('DockerRunnerSession.dispose', { skip }, () => {
  it('force-removes the container and blocks further exec/preview (idempotent)', async () => {
    const s = await new DockerRunner().boot()
    const container = s.container
    await s.dispose()
    assert.equal(s.disposed, true)
    // The container is actually gone, not just flagged disposed.
    const left = execFileSync('docker', ['ps', '-aq', '--filter', `name=${container}`], { encoding: 'utf8' }).trim()
    assert.equal(left, '')
    await s.dispose() // idempotent
    await assert.rejects(() => s.exec('ls'), RunnerError)
    await assert.rejects(() => s.preview!(), RunnerError)
  })
})

describe('DockerRunnerSession.start (boot and serve)', { skip }, () => {
  it('serves a real background server that preview can reach, then stop kills it', async () => {
    const s = await new DockerRunner().boot({ files: { 'server.js': httpServer(3000, 'hello from docker') } })
    try {
      const proc = await s.start('node server.js')
      assert.equal(proc.command, 'node server.js')

      const preview = await s.preview!({ port: 3000, waitMs: 8000 })
      const res = await fetch(preview.url)
      assert.equal(await res.text(), 'hello from docker') // the app is actually serving from inside the container

      await proc.stop()
      await assert.rejects(fetch(preview.url)) // host port no longer forwards
    } finally {
      await s.dispose()
    }
  })

  it('start does not block on a long-running process', async () => {
    const s = await new DockerRunner().boot({ files: { 'server.js': httpServer(3000, 'x') } })
    try {
      const proc = await s.start('node server.js')
      let exited = false
      void proc.exit.then(() => (exited = true))
      assert.equal(exited, false) // still running right after start
      await proc.stop()
    } finally {
      await s.dispose()
    }
  })
})
