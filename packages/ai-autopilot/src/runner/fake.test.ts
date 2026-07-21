import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeRunner } from './fake.js'
import { RunnerError } from './types.js'

describe('FakeRunner.boot', () => {
  it('seeds the workspace with files and normalizes paths', async () => {
    const runner = new FakeRunner()
    const s = await runner.boot({ files: { './pages/+Page.jsx': 'PAGE', 'app.ts': 'APP' } })
    assert.equal(await s.fs.read('pages/+Page.jsx'), 'PAGE')
    assert.equal(await s.fs.read('/app.ts'), 'APP') // leading slash normalized
    assert.deepEqual(s.snapshot(), { 'pages/+Page.jsx': 'PAGE', 'app.ts': 'APP' })
  })

  it('gives each session a distinct id and tracks them', async () => {
    const runner = new FakeRunner()
    const a = await runner.boot()
    const b = await runner.boot()
    assert.notEqual(a.id, b.id)
    assert.deepEqual(runner.sessions, [a, b])
  })
})

describe('FakeRunnerSession.fs', () => {
  it('writes, reads, checks existence, lists, and removes', async () => {
    const s = await new FakeRunner().boot()
    assert.equal(await s.fs.exists('a.txt'), false)
    await s.fs.write('src/a.txt', 'A')
    await s.fs.write('src/b.txt', 'B')
    await s.fs.write('root.txt', 'R')
    assert.equal(await s.fs.exists('src/a.txt'), true)
    assert.deepEqual(await s.fs.list('src'), ['src/a.txt', 'src/b.txt'])
    assert.deepEqual(await s.fs.list(), ['root.txt', 'src/a.txt', 'src/b.txt'])
    await s.fs.remove('src/a.txt')
    assert.equal(await s.fs.exists('src/a.txt'), false)
  })

  it('throws reading a missing file', async () => {
    const s = await new FakeRunner().boot()
    await assert.rejects(() => s.fs.read('nope.txt'), RunnerError)
  })

  it('refuses paths that escape the workspace, like the real runners', async () => {
    const s = await new FakeRunner().boot()
    for (const path of ['../evil.txt', '../../etc/passwd', 'a/../../b', '..']) {
      await assert.rejects(() => s.fs.write(path, 'x'), RunnerError)
      await assert.rejects(() => s.fs.read(path), RunnerError)
    }
  })

  it('resolves `.` and in-workspace `..` to the same file the real runners do', async () => {
    const s = await new FakeRunner().boot()
    await s.fs.write('src/./a.txt', 'A') // `.` is a no-op segment
    await s.fs.write('src/tmp/../b.txt', 'B') // `..` pops `tmp`, staying inside
    assert.equal(await s.fs.read('src/a.txt'), 'A')
    assert.equal(await s.fs.read('src/b.txt'), 'B')
    assert.deepEqual(await s.fs.list('src'), ['src/a.txt', 'src/b.txt'])
  })

  it('lists the whole workspace for `.` and `/`, as the real runners do (#998)', async () => {
    const s = await new FakeRunner().boot()
    await s.fs.write('src/a.txt', 'A')
    await s.fs.write('root.txt', 'R')
    // `list_files` passes the model's `dir` through verbatim, and `.` is the most
    // natural thing it types for the workspace root.
    const all = ['root.txt', 'src/a.txt']
    assert.deepEqual(await s.fs.list('.'), all)
    assert.deepEqual(await s.fs.list('/'), all)
    assert.deepEqual(await s.fs.list('./'), all)
    assert.deepEqual(await s.fs.list(''), all)
    assert.deepEqual(await s.fs.list(), all)
  })
})

describe('FakeRunnerSession.exec', () => {
  it('returns exit 0 with empty output by default and records the call', async () => {
    const s = await new FakeRunner().boot()
    const r = await s.exec('pnpm build', { cwd: 'app' })
    assert.deepEqual(r, { stdout: '', stderr: '', exitCode: 0 })
    assert.deepEqual(s.execCalls, [{ command: 'pnpm build', opts: { cwd: 'app' } }])
  })

  it('uses a programmable onExec', async () => {
    const runner = new FakeRunner({
      onExec: cmd =>
        cmd.startsWith('pnpm build')
          ? { stdout: 'built', stderr: '', exitCode: 0 }
          : { stdout: '', stderr: 'unknown', exitCode: 1 },
    })
    const s = await runner.boot()
    assert.equal((await s.exec('pnpm build')).stdout, 'built')
    assert.equal((await s.exec('frobnicate')).exitCode, 1)
  })
})

describe('FakeRunnerSession.preview', () => {
  it('returns a fake url on the requested port when supported', async () => {
    const s = await new FakeRunner({ previewUrl: 'https://x.local' }).boot()
    assert.equal(typeof s.preview, 'function')
    assert.deepEqual(await s.preview!({ port: 5173 }), { url: 'https://x.local:5173', port: 5173 })
    assert.equal((await s.preview!()).port, 3000) // default port
  })

  it('omits the preview method when the runner cannot preview', async () => {
    const s = await new FakeRunner({ preview: false }).boot()
    assert.equal(s.preview, undefined)
  })
})

describe('FakeRunnerSession.start', () => {
  it('records start calls and returns a controllable process handle', async () => {
    const s = await new FakeRunner().boot()
    const proc = await s.start!('npm run dev', { cwd: 'app' })
    assert.deepEqual(s.startCalls, [{ command: 'npm run dev', opts: { cwd: 'app' } }])
    assert.equal(s.processes.length, 1)
    assert.equal(proc.command, 'npm run dev')

    let exited = false
    void proc.exit.then(() => (exited = true))
    assert.equal(exited, false) // still "running" until stopped
    await proc.stop()
    assert.equal((await proc.exit).exitCode, 0)
  })

  it('omits start when background is disabled (capability signal)', async () => {
    const s = await new FakeRunner({ background: false }).boot()
    assert.equal(s.start, undefined)
  })

  it('dispose stops still-running processes', async () => {
    const s = await new FakeRunner().boot()
    const proc = await s.start!('node server.js')
    await s.dispose()
    assert.equal((await proc.exit).exitCode, 0) // resolved by dispose
  })

  it('rejects start on a disposed session', async () => {
    const s = await new FakeRunner().boot()
    await s.dispose()
    await assert.rejects(() => s.start!('node server.js'), RunnerError)
  })
})

describe('FakeRunnerSession.dispose', () => {
  it('marks disposed and blocks further exec/preview', async () => {
    const s = await new FakeRunner().boot()
    await s.dispose()
    assert.equal(s.disposed, true)
    await assert.rejects(() => s.exec('ls'), RunnerError)
    await assert.rejects(() => s.preview!(), RunnerError)
  })
})
