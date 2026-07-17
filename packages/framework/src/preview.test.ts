import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectDevScript, detectServeTargets, parsePreviewUrl, startPreview, PREVIEW_SCRIPTS } from './preview.js'

async function withTmp(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `framework-${prefix}-`))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Write a `package.json` (creating the dir) with the given fields. */
async function writePkg(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify(pkg))
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

test('detectServeTargets: a single-package repo yields just the root, labelled by name', async () => {
  await withTmp('targets-single', async dir => {
    await writePkg(dir, { name: 'my-app', scripts: { dev: 'vite' } })
    const targets = await detectServeTargets(dir)
    assert.deepEqual(targets, [{ id: '.', label: 'my-app', dir: '', script: 'dev' }])
  })
})

test('detectServeTargets: a root with no serve script yields nothing', async () => {
  await withTmp('targets-noroot', async dir => {
    await writePkg(dir, { name: 'x', scripts: { build: 'tsc', test: 'node' } })
    assert.deepEqual(await detectServeTargets(dir), [])
  })
})

test('detectServeTargets: pnpm workspaces list each servable package, root first then sorted', async () => {
  await withTmp('targets-pnpm', async dir => {
    // Root has no serve script; the two workspace apps do (one lacks a name → dir basename label).
    await writePkg(dir, { name: 'monorepo', scripts: { build: 'turbo build' } })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n')
    await writePkg(join(dir, 'apps', 'web'), { name: '@acme/web', scripts: { dev: 'vite' } })
    await writePkg(join(dir, 'apps', 'api'), { scripts: { start: 'node server.js' } })
    await writePkg(join(dir, 'packages', 'lib'), { name: '@acme/lib', scripts: { build: 'tsc' } }) // no serve script → excluded
    const targets = await detectServeTargets(dir)
    assert.deepEqual(targets, [
      { id: 'apps/api', label: 'api', dir: 'apps/api', script: 'start' },
      { id: 'apps/web', label: '@acme/web', dir: 'apps/web', script: 'dev' },
    ])
  })
})

test('detectServeTargets: root with its own serve script comes first, ahead of workspaces', async () => {
  await withTmp('targets-rootfirst', async dir => {
    await writePkg(dir, { name: 'root-app', scripts: { dev: 'vite' } })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n')
    await writePkg(join(dir, 'apps', 'web'), { name: 'web', scripts: { dev: 'vite' } })
    const targets = await detectServeTargets(dir)
    assert.deepEqual(targets.map(t => t.id), ['.', 'apps/web'])
  })
})

test('detectServeTargets: npm/yarn `workspaces` field (array and {packages})', async () => {
  await withTmp('targets-npm-array', async dir => {
    await writePkg(dir, { name: 'r', workspaces: ['apps/*'], scripts: { build: 'x' } })
    await writePkg(join(dir, 'apps', 'site'), { name: 'site', scripts: { serve: 'http-server' } })
    assert.deepEqual((await detectServeTargets(dir)).map(t => t.id), ['apps/site'])
  })
  await withTmp('targets-npm-obj', async dir => {
    await writePkg(dir, { name: 'r', workspaces: { packages: ['apps/*'] }, scripts: { build: 'x' } })
    await writePkg(join(dir, 'apps', 'site'), { name: 'site', scripts: { preview: 'vite preview' } })
    assert.deepEqual((await detectServeTargets(dir)).map(t => t.script), ['preview'])
  })
})

test('detectServeTargets: a trailing ** glob matches nested packages, node_modules skipped', async () => {
  await withTmp('targets-globstar', async dir => {
    await writePkg(dir, { name: 'r', scripts: { build: 'x' } })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/**"\n')
    await writePkg(join(dir, 'packages', 'a'), { name: 'a', scripts: { dev: 'vite' } })
    await writePkg(join(dir, 'packages', 'group', 'b'), { name: 'b', scripts: { dev: 'vite' } })
    await writePkg(join(dir, 'packages', 'node_modules', 'dep'), { name: 'dep', scripts: { dev: 'x' } }) // must be skipped
    const ids = (await detectServeTargets(dir)).map(t => t.id).sort()
    assert.deepEqual(ids, ['packages/a', 'packages/group/b'])
  })
})

test('detectServeTargets: a literal (non-glob) workspace entry resolves directly', async () => {
  await withTmp('targets-literal', async dir => {
    await writePkg(dir, { name: 'r', scripts: { build: 'x' } })
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "docs"\n')
    await writePkg(join(dir, 'docs'), { name: 'docs', scripts: { dev: 'vitepress' } })
    assert.deepEqual((await detectServeTargets(dir)).map(t => t.id), ['docs'])
  })
})
