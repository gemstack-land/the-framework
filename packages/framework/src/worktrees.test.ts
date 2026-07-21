import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { formatWorktreeList, removeProjectWorktree, type WorktreeRow } from './worktrees.js'
import { addWorktree, runBranchName } from './store/index.js'
import { nodeGitRunner } from './project.js'

const row = (over: Partial<WorktreeRow> & { runId: string }): WorktreeRow => ({ live: false, ...over })

test('the worktrees table pads its columns and names every session (#752)', () => {
  const lines = formatWorktreeList([
    row({ runId: '2026-07-20T10-00-00-000Z', status: 'stopped', sizeBytes: 1536, branch: 'the-framework/add-login' }),
    row({ runId: '2026-07-19T09-00-00-000Z', status: 'failed' }),
    row({ runId: '2026-07-18T08-00-00-000Z', status: 'running', live: true }),
  ])
  assert.equal(lines[0], 'SESSION                   STATUS   SIZE    BRANCH')
  assert.equal(lines[1], '2026-07-20T10-00-00-000Z  stopped  1.5 KB  the-framework/add-login')
  assert.equal(lines[2], '2026-07-19T09-00-00-000Z  failed   -       -', 'no size and no branch still line up')
  assert.equal(lines[3], '2026-07-18T08-00-00-000Z  running  -       -', 'a live session is listed, not hidden')
})

test('an empty list says why there is nothing rather than printing a bare header (#752)', () => {
  assert.deepEqual(formatWorktreeList([]), ['No worktrees. A session that finished cleanly does not keep one.'])
})

test('a worktree whose run left no meta is listed as unknown, not skipped (#752)', () => {
  const lines = formatWorktreeList([row({ runId: 'orphan' })])
  assert.equal(lines[1], 'orphan   unknown  -     -')
})

// #982: a worktree is only retained when its run failed or was stopped, which is exactly when it
// is still holding uncommitted agent work — so the removal both surfaces offer has to commit
// first, the way teardown does (#786), rather than force past a tree git calls unclean.
// Against real git, because "was the diff actually destroyed" is not a question a fake answers.

const RUN_ID = 'run1'

/** A repo whose retained worktree holds an uncommitted edit, as a failed run leaves one. */
async function repoWithDirtyWorktree(): Promise<{ repo: string; path: string; branch: string }> {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what git reports (the /var -> /private/var symlink).
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'framework-worktrees-')))
  await git(['init'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-m', 'init'], repo)
  const { path, branch } = await addWorktree(repo, { runId: RUN_ID, branch: runBranchName(RUN_ID) }, git)
  await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')
  return { repo, path, branch }
}

test('removing a retained worktree keeps the work it was holding, on the run branch (#982)', async () => {
  const { repo, path, branch } = await repoWithDirtyWorktree()
  try {
    assert.deepEqual(await removeProjectWorktree(repo, RUN_ID), { ok: true })
    await assert.rejects(() => stat(path), 'the checkout is gone')
    const shown = await nodeGitRunner()(['show', `${branch}:index.html`], repo)
    assert.match(shown, /Welcome!/, 'the uncommitted edit survived on the branch instead of being forced away')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a worktree whose work cannot be committed is refused, not force-removed (#982)', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  try {
    // A refusing pre-commit hook is the reproducible version of "no git identity": the commit
    // fails, so the work only exists in the working tree and the checkout must survive.
    const hooks = join(repo, 'hooks')
    await mkdir(hooks, { recursive: true })
    await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await nodeGitRunner()(['config', 'core.hooksPath', hooks], repo)

    const result = await removeProjectWorktree(repo, RUN_ID)
    assert.equal(result.ok, false, 'removal is refused rather than forced')
    assert.match(result.ok === false ? result.error : '', /uncommitted work/)
    assert.equal((await stat(path)).isDirectory(), true, 'the checkout is still on disk')
    assert.match(await readFile(join(path, 'index.html'), 'utf8'), /Welcome!/, 'with the work still in it')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('an unknown session is refused before any git runs (#982)', async () => {
  const { repo, path } = await repoWithDirtyWorktree()
  try {
    assert.deepEqual(await removeProjectWorktree(repo, 'nosuchrun'), {
      ok: false,
      error: 'no worktree for session nosuchrun',
    })
    assert.equal((await stat(path)).isDirectory(), true, 'the real worktree is untouched')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
