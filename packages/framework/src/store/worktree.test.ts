import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile, stat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { GitRunner } from '../project.js'
import { nodeGitRunner } from '../project.js'
import {
  addWorktree,
  listWorktrees,
  parseWorktreeList,
  removeWorktree,
  pruneWorktrees,
  worktreePath,
  FRAMEWORK_DIR,
} from './index.js'

const REPO = '/repo'

/** A {@link GitRunner} that records its calls and returns a canned stdout. */
function recordingGit(stdout = ''): GitRunner & { calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = []
  const run: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    return stdout
  }
  return Object.assign(run, { calls })
}

const failingGit: GitRunner = async () => {
  throw new Error('not a git repository')
}

test('worktreePath nests the run under .the-framework/worktrees', () => {
  assert.equal(worktreePath(REPO, '2026-07-19T10-00-00-000Z'), join(REPO, FRAMEWORK_DIR, 'worktrees', '2026-07-19T10-00-00-000Z'))
})

test('addWorktree builds `worktree add -b <branch> <path>` and returns the path + branch', async () => {
  const git = recordingGit()
  const added = await addWorktree(REPO, { runId: 'run1', branch: 'the-framework/run-run1' }, git)
  const path = worktreePath(REPO, 'run1')
  assert.deepEqual(added, { path, branch: 'the-framework/run-run1' })
  assert.deepEqual(git.calls, [{ args: ['worktree', 'add', '-b', 'the-framework/run-run1', path], cwd: REPO }])
})

test('addWorktree appends the base ref when given', async () => {
  const git = recordingGit()
  await addWorktree(REPO, { runId: 'run1', branch: 'b', base: 'origin/main' }, git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'add', '-b', 'b', worktreePath(REPO, 'run1'), 'origin/main'])
})

test('addWorktree rejects an unsafe run id before touching git (no traversal out of worktrees/)', async () => {
  const git = recordingGit()
  await assert.rejects(() => addWorktree(REPO, { runId: '../evil', branch: 'b' }, git), /unsafe run id/)
  assert.equal(git.calls.length, 0)
})

test('parseWorktreeList reads path/head/branch and strips refs/heads/, dropping detached branches', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/.the-framework/worktrees/run1',
    'HEAD bbbb',
    'branch refs/heads/the-framework/run-run1',
    '',
    'worktree /repo/detached',
    'HEAD cccc',
    'detached',
    '',
  ].join('\n')
  assert.deepEqual(parseWorktreeList(porcelain), [
    { path: '/repo', head: 'aaaa', branch: 'main' },
    { path: '/repo/.the-framework/worktrees/run1', head: 'bbbb', branch: 'the-framework/run-run1' },
    { path: '/repo/detached', head: 'cccc' },
  ])
})

test('parseWorktreeList yields [] for empty output', () => {
  assert.deepEqual(parseWorktreeList(''), [])
})

test('listWorktrees passes --porcelain and is forgiving of a git failure', async () => {
  const git = recordingGit('worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n')
  const entries = await listWorktrees(REPO, git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'list', '--porcelain'])
  assert.deepEqual(entries, [{ path: '/repo', head: 'aaaa', branch: 'main' }])
  assert.deepEqual(await listWorktrees(REPO, failingGit), [])
})

test('removeWorktree forces the removal and tolerates an already-gone path', async () => {
  const git = recordingGit()
  await removeWorktree(REPO, '/repo/wt', git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'remove', '--force', '/repo/wt'])
  await assert.doesNotReject(() => removeWorktree(REPO, '/repo/gone', failingGit))
})

test('pruneWorktrees runs `worktree prune` and tolerates failure', async () => {
  const git = recordingGit()
  await pruneWorktrees(REPO, git)
  assert.deepEqual(git.calls[0]?.args, ['worktree', 'prune'])
  await assert.doesNotReject(() => pruneWorktrees(REPO, failingGit))
})

// End-to-end against real git: the whole point of the module is that the plumbing
// works, so add -> list -> remove -> prune is exercised on a temp repo.
test('add/list/remove round-trips against a real git repo', async () => {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what `git worktree list` reports: on
  // macOS tmpdir is under the /var -> /private/var symlink (same gotcha as
  // enumerateGitRepos in install.ts).
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'framework-worktree-')))
  try {
    await git(['init'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)

    const { path, branch } = await addWorktree(repo, { runId: 'run1', branch: 'the-framework/run-run1' }, git)
    assert.equal((await stat(path)).isDirectory(), true, 'worktree checkout dir exists')
    assert.equal((await stat(join(path, 'README.md'))).isFile(), true, 'checkout has the repo content')

    const listed = await listWorktrees(repo, git)
    assert.ok(listed.some(w => w.path === path && w.branch === branch), 'new worktree shows up with its branch')

    await removeWorktree(repo, path, git)
    await assert.rejects(() => stat(path), 'checkout dir is gone after removal')
    assert.equal((await listWorktrees(repo, git)).some(w => w.path === path), false, 'removed worktree is no longer listed')

    await assert.doesNotReject(() => pruneWorktrees(repo, git))
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
