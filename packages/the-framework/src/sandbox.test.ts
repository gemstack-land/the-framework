import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotWorkspace, SANDBOX_IGNORE } from './sandbox.js'

test('snapshotWorkspace copies source (incl. nested) and skips build/VCS dirs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-snap-'))
  try {
    await writeFile(join(dir, 'package.json'), '{"name":"x"}')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'app.js'), 'export const a = 1\n')
    // Dirs that must never be copied: the sandbox installs/builds its own.
    await mkdir(join(dir, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1')
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, '.git', 'config'), '[core]')
    await mkdir(join(dir, 'dist'), { recursive: true })
    await writeFile(join(dir, 'dist', 'out.js'), 'built')

    const tree = await snapshotWorkspace(dir)
    assert.deepEqual(Object.keys(tree).sort(), ['package.json', 'src/app.js'])
    assert.equal(tree['src/app.js'], 'export const a = 1\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('snapshotWorkspace skips binary files and oversized files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fw-snap-'))
  try {
    await writeFile(join(dir, 'keep.txt'), 'hello')
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02])) // has a NUL → binary
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(2048))

    const tree = await snapshotWorkspace(dir, { maxFileBytes: 1024 })
    assert.deepEqual(Object.keys(tree), ['keep.txt'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('SANDBOX_IGNORE lists the build/VCS/cache dirs', () => {
  for (const name of ['node_modules', '.git', 'dist', '.the-framework']) {
    assert.ok(SANDBOX_IGNORE.has(name), `${name} is ignored`)
  }
})
