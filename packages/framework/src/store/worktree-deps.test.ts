import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { findDependencyDirs, linkDependencies, nodeLinkFs, type LinkFs } from './index.js'

/** A {@link LinkFs} over an in-memory set of directory paths, recording the links made. */
function fakeFs(dirs: string[]): LinkFs & { links: { target: string; path: string }[] } {
  const set = new Set(dirs)
  const links: { target: string; path: string }[] = []
  return {
    links,
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : path + '/'
      const names = new Set<string>()
      for (const dir of set) {
        if (!dir.startsWith(prefix)) continue
        const name = dir.slice(prefix.length).split('/')[0]
        if (name) names.add(name)
      }
      return [...names]
    },
    async isDirectory(path) {
      return set.has(path)
    },
    async entryExists(path) {
      return set.has(path)
    },
    async mkdir(path) {
      set.add(path)
    },
    async symlinkDir(target, path) {
      links.push({ target, path })
      set.add(path)
    },
  }
}

test('findDependencyDirs finds the root and every workspace package tree (#736)', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    '/repo/packages',
    '/repo/packages/a',
    '/repo/packages/a/node_modules',
    '/repo/packages/b',
    '/repo/packages/b/node_modules',
  ])
  assert.deepEqual(await findDependencyDirs('/repo', fs), [
    'node_modules',
    'packages/a/node_modules',
    'packages/b/node_modules',
  ])
})

test('findDependencyDirs never descends into node_modules or dot dirs', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    // A nested tree inside node_modules would be linked twice over, and there are
    // thousands of them: the scan must stop at the top-level tree.
    '/repo/node_modules/pkg',
    '/repo/node_modules/pkg/node_modules',
    '/repo/.git',
    '/repo/.git/node_modules',
    '/repo/.the-framework',
    '/repo/.the-framework/node_modules',
  ])
  assert.deepEqual(await findDependencyDirs('/repo', fs), ['node_modules'])
})

test('linkDependencies mirrors each tree into the worktree at the same relative path', async () => {
  const fs = fakeFs(['/repo', '/repo/node_modules', '/repo/packages', '/repo/packages/a', '/repo/packages/a/node_modules', '/wt'])
  const linked = await linkDependencies('/repo', '/wt', fs)
  assert.deepEqual(linked, ['node_modules', 'packages/a/node_modules'])
  assert.deepEqual(fs.links, [
    { target: '/repo/node_modules', path: '/wt/node_modules' },
    // The worktree has the package dir (it is tracked), so only the link is made.
    { target: '/repo/packages/a/node_modules', path: '/wt/packages/a/node_modules' },
  ])
})

test('linkDependencies leaves an existing tree alone (a run may have installed its own)', async () => {
  const fs = fakeFs(['/repo', '/repo/node_modules', '/wt', '/wt/node_modules'])
  assert.deepEqual(await linkDependencies('/repo', '/wt', fs), [])
  assert.deepEqual(fs.links, [])
})

test('linkDependencies swallows a filesystem that refuses the link (a run still starts)', async () => {
  const fs = fakeFs(['/repo', '/repo/node_modules', '/wt'])
  fs.symlinkDir = async () => {
    throw new Error('EPERM')
  }
  assert.deepEqual(await linkDependencies('/repo', '/wt', fs), [])
})

// The point of the module is that a real worktree can resolve a real dependency, so
// link it on disk and read a file back through the symlink.
test('linkDependencies gives a real worktree a working dependency tree', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'framework-deps-')))
  try {
    const repo = join(root, 'repo')
    const wt = join(root, 'wt')
    await mkdir(join(repo, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = 1\n')
    await mkdir(join(repo, 'packages', 'a', 'node_modules'), { recursive: true })
    await mkdir(join(wt, 'packages', 'a'), { recursive: true })

    const linked = await linkDependencies(repo, wt, nodeLinkFs())
    assert.deepEqual(linked, ['node_modules', 'packages/a/node_modules'])
    assert.equal((await lstat(join(wt, 'node_modules'))).isSymbolicLink(), true, 'linked, not copied')
    assert.equal(await readFile(join(wt, 'node_modules', 'dep', 'index.js'), 'utf8'), 'module.exports = 1\n')

    // Idempotent: a second call over the same worktree links nothing new.
    assert.deepEqual(await linkDependencies(repo, wt, nodeLinkFs()), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
