import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { listReposInDirectory, type ReposDirectoryFs } from './repos-directory.js'

/**
 * A fake fs modelling a directory tree as a set of file paths and a set of directory paths, so the
 * scan is tested without touching disk. A `.git` listed under `files` models a worktree/submodule
 * pointer file; one listed under `dirs` models a normal clone.
 */
function fakeFs(tree: { dirs?: string[]; files?: string[] }): ReposDirectoryFs {
  const dirs = new Set(tree.dirs ?? [])
  const files = new Set(tree.files ?? [])
  return {
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : path + '/'
      const names = new Set<string>()
      for (const entry of [...dirs, ...files]) {
        if (!entry.startsWith(prefix)) continue
        const rest = entry.slice(prefix.length)
        if (!rest.includes('/')) names.add(rest)
      }
      return [...names]
    },
    async isDirectory(path) {
      return dirs.has(path)
    },
    async exists(path) {
      return files.has(path)
    },
  }
}

test('listReposInDirectory returns only the child dirs holding a .git (#1123)', async () => {
  const root = '/home/u/repos'
  const fs = fakeFs({
    dirs: [
      root,
      join(root, 'app-a'),
      join(root, 'app-a', '.git'), // normal clone: .git is a directory
      join(root, 'app-b'),
      join(root, 'not-a-repo'), // a plain directory, no .git
    ],
    files: [
      join(root, 'app-b', '.git'), // worktree/submodule: .git is a file
      join(root, 'README.md'), // a loose file, not a directory
    ],
  })
  assert.deepEqual(await listReposInDirectory(root, fs), [join(root, 'app-a'), join(root, 'app-b')])
})

test('listReposInDirectory yields [] for a missing directory (#1123)', async () => {
  assert.deepEqual(await listReposInDirectory('/nope', fakeFs({})), [])
})
