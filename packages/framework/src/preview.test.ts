import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectDevScript, parsePreviewUrl, startPreview, PREVIEW_SCRIPTS } from './preview.js'

async function withTmp(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `framework-${prefix}-`))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('parsePreviewUrl reads the first localhost URL a dev server prints', () => {
  assert.equal(parsePreviewUrl('  ➜  Local:   http://localhost:5173/'), 'http://localhost:5173/')
  assert.equal(parsePreviewUrl('- Local:        http://localhost:3000'), 'http://localhost:3000')
  // 0.0.0.0 is normalized to a browsable host; trailing punctuation is trimmed.
  assert.equal(parsePreviewUrl('listening on http://0.0.0.0:8080.'), 'http://localhost:8080')
  // ANSI color codes around the URL are stripped.
  assert.equal(parsePreviewUrl('[32mhttp://127.0.0.1:4321/[0m'), 'http://127.0.0.1:4321/')
  // Nothing to find yet.
  assert.equal(parsePreviewUrl('starting the dev server...'), undefined)
})

test('detectDevScript picks the first available preview script, best-first', async () => {
  assert.deepEqual([...PREVIEW_SCRIPTS], ['dev', 'start', 'preview', 'serve'])
  await withTmp('detect', async dir => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x', start: 'y', dev: 'z' } }))
    assert.equal(await detectDevScript(dir), 'dev') // dev wins over start
  })
  await withTmp('detect-start', async dir => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x', serve: 'y', start: 'z' } }))
    assert.equal(await detectDevScript(dir), 'start') // start wins over serve
  })
})

test('detectDevScript returns undefined with no package.json or no matching script', async () => {
  await withTmp('detect-none', async dir => {
    assert.equal(await detectDevScript(dir), undefined)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'x', test: 'y' } }))
    assert.equal(await detectDevScript(dir), undefined)
  })
})

test('startPreview falls back to a static server for a plain index.html and serves it', async () => {
  await withTmp('static', async dir => {
    await writeFile(join(dir, 'index.html'), '<h1>hello preview</h1>')
    const handle = await startPreview({ cwd: dir })
    try {
      assert.equal(handle.command, 'static')
      assert.match(handle.url, /^http:\/\/localhost:\d+$/)
      const body = await fetch(handle.url).then(r => r.text())
      assert.match(body, /hello preview/)
    } finally {
      await handle.stop()
    }
  })
})

test('a preview handle resolves `exited` on stop, and reopening rebinds cleanly', async () => {
  await withTmp('exit', async dir => {
    await writeFile(join(dir, 'index.html'), '<h1>x</h1>')
    const first = await startPreview({ cwd: dir })
    let done = false
    void first.exited.then(() => (done = true))
    await first.stop()
    // `exited` has resolved by the time stop() returns (the daemon's eviction hook fires).
    await Promise.resolve()
    assert.equal(done, true)
    // A fresh open after stop works (the port was freed) — the second-click path.
    const second = await startPreview({ cwd: dir })
    try {
      assert.match(second.url, /^http:\/\/localhost:\d+$/)
    } finally {
      await second.stop()
    }
  })
})

test('startPreview throws when there is nothing to serve', async () => {
  await withTmp('empty', async dir => {
    await assert.rejects(startPreview({ cwd: dir }), /nothing to preview/)
  })
})
