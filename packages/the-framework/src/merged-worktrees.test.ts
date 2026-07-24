import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import {
  landedVia,
  removeMergedWorktrees,
  startMergedWorktreeSweep,
  type MergedSweepResult,
  type RemovedWorktree,
} from './merged-worktrees.js'
import { readRunHandoff, type RunHandoff } from './dashboard/run-handoff.js'
import { addWorktree, runBranchName } from './store/index.js'
import { nodeGitRunner } from './project.js'
import type { WorktreeRow } from './worktrees.js'

// #1036: a session's checkout is reclaimed once its work has landed. The branch, its commits and
// the session's own records are kept, which is what makes deleting the checkout safe at all.

const handoff = (over: Partial<RunHandoff> = {}): RunHandoff => ({
  branch: 'the-framework/run-run1',
  exists: true,
  base: 'main',
  commits: [],
  files: [],
  insertions: 0,
  deletions: 0,
  empty: false,
  hasRemote: true,
  pushed: true,
  merged: false,
  ...over,
})

const pr = (state: string) => ({ number: 7, url: 'https://example.test/pr/7', state, title: 'Add login' })

test('a branch merged into the base has landed (#1036)', () => {
  assert.equal(landedVia(handoff({ merged: true })), 'branch')
})

test('a merged PR has landed even when the local branch is not an ancestor (#1036)', () => {
  // The squash-merge case: git says not merged, GitHub says it is in the base.
  assert.equal(landedVia(handoff({ merged: false, pr: pr('MERGED') })), 'pr')
})

test('the local signal wins when both agree, so the reason reported is the stronger one (#1036)', () => {
  assert.equal(landedVia(handoff({ merged: true, pr: pr('MERGED') })), 'branch')
})

test('an open PR has not landed (#1036)', () => {
  assert.equal(landedVia(handoff({ pr: pr('OPEN') })), undefined)
})

test('a closed-unmerged PR has NOT landed: rejected work is what you most want to still read (#1036)', () => {
  assert.equal(landedVia(handoff({ pr: pr('CLOSED') })), undefined)
})

test('a branch with neither signal has not landed (#1036)', () => {
  assert.equal(landedVia(handoff()), undefined)
})

/** A sweep over fixed rows, recording which run ids removal was asked for. */
function fakeSweep(rows: WorktreeRow[], states: Record<string, RunHandoff | undefined>) {
  const asked: string[] = []
  const run = (over: { remove?: (cwd: string, runId: string) => Promise<{ ok: true } | { ok: false; error: string }> } = {}) =>
    removeMergedWorktrees('/repo', {
      worktrees: async () => rows,
      runs: async () => [],
      handoff: async (_cwd, branch) => states[branch],
      remove: async (_cwd, runId) => {
        asked.push(runId)
        return over.remove ? over.remove(_cwd, runId) : { ok: true }
      },
    })
  return { asked, run }
}

const row = (over: Partial<WorktreeRow> & { runId: string }): WorktreeRow => ({ live: false, ...over })

test('a landed session loses its checkout and an unlanded one keeps it (#1036)', async () => {
  const { asked, run } = fakeSweep(
    [row({ runId: 'landed' }), row({ runId: 'working' })],
    {
      'the-framework/run-landed': handoff({ branch: 'the-framework/run-landed', merged: true }),
      'the-framework/run-working': handoff({ branch: 'the-framework/run-working' }),
    },
  )
  const result = await run()
  assert.deepEqual(asked, ['landed'])
  assert.deepEqual(result.removed, [{ runId: 'landed', branch: 'the-framework/run-landed', via: 'branch' }])
  assert.deepEqual(result.failed, [])
})

test('a live session keeps its checkout even when its branch already landed (#1036)', async () => {
  // Its agent is working in there. Stop is how a run ends, not pulling the floor out from under it.
  const { asked, run } = fakeSweep([row({ runId: 'live', live: true, status: 'running' })], {
    'the-framework/run-live': handoff({ branch: 'the-framework/run-live', merged: true }),
  })
  const { removed } = await run()
  assert.deepEqual(removed, [])
  assert.deepEqual(asked, [])
})

test('a branch that no longer exists keeps its checkout: nothing to recover it from (#1036)', async () => {
  const { asked, run } = fakeSweep([row({ runId: 'gone' })], {
    'the-framework/run-gone': handoff({ branch: 'the-framework/run-gone', exists: false, merged: true }),
  })
  const { removed } = await run()
  assert.deepEqual(removed, [])
  assert.deepEqual(asked, [])
})

test('an unreadable branch state is skipped, never guessed at (#1036)', async () => {
  const { removed } = await removeMergedWorktrees('/repo', {
    worktrees: async () => [row({ runId: 'unreadable' })],
    runs: async () => [],
    handoff: async () => {
      throw new Error('git exploded')
    },
    remove: async () => assert.fail('an unreadable repo must never be a reason to delete a checkout'),
  })
  assert.deepEqual(removed, [])
})

test('the branch a row recorded is preferred over the derived one (#799/#1036)', async () => {
  const seen: string[] = []
  await removeMergedWorktrees('/repo', {
    worktrees: async () => [row({ runId: 'run1', branch: 'feat/agent-named-this' })],
    runs: async () => [],
    handoff: async (_cwd, branch) => (seen.push(branch), undefined),
    remove: async () => ({ ok: true }),
  })
  assert.deepEqual(seen, ['feat/agent-named-this'])
})

test('a failed removal is reported rather than counted as reclaimed (#1036)', async () => {
  const { run } = fakeSweep([row({ runId: 'stuck' })], {
    'the-framework/run-stuck': handoff({ branch: 'the-framework/run-stuck', merged: true }),
  })
  const result = await run({ remove: async () => ({ ok: false, error: 'index.lock exists' }) })
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.failed, [{ runId: 'stuck', error: 'index.lock exists' }])
})

test('an unlisted project sweeps nothing rather than failing (#1036)', async () => {
  const result = await removeMergedWorktrees('/repo', {
    worktrees: async () => {
      throw new Error('not a repo')
    },
  })
  assert.deepEqual(result, { removed: [], failed: [] })
})

// The sweep loop over projects.

test('the sweep says what it removed and why, per project (#1036)', async () => {
  const lines: string[] = []
  const results: Record<string, MergedSweepResult> = {
    '/a': { removed: [{ runId: 'r1', branch: 'the-framework/run-r1', via: 'branch' } as RemovedWorktree], failed: [] },
    '/b': { removed: [{ runId: 'r2', branch: 'feat/x', via: 'pr' } as RemovedWorktree], failed: [{ runId: 'r3', error: 'busy' }] },
  }
  const sweep = startMergedWorktreeSweep({
    projects: async () => [{ path: '/a' }, { path: '/b' }],
    log: line => lines.push(line),
    sweep: async cwd => results[cwd] ?? { removed: [], failed: [] },
    intervalMs: 60_000,
  })
  await sweep.tick()
  sweep.stop()
  assert.match(lines[0] ?? '', /removed the worktree for session r1: the-framework\/run-r1 is merged into the base/)
  assert.match(lines[0] ?? '', /The branch and the session are kept/, 'a checkout vanishing silently reads as a bug')
  assert.match(lines[1] ?? '', /removed the worktree for session r2: feat\/x was merged on GitHub/)
  assert.match(lines[2] ?? '', /could not remove the landed worktree for session r3: busy/)
})

test('a stopped sweep does no further work (#1036)', async () => {
  let swept = 0
  const sweep = startMergedWorktreeSweep({
    projects: async () => [{ path: '/a' }],
    log: () => {},
    sweep: async () => (swept++, { removed: [], failed: [] }),
    intervalMs: 60_000,
  })
  await sweep.tick()
  sweep.stop()
  await sweep.tick()
  assert.equal(swept, 1)
})

test('a project whose sweep throws does not stop the ones after it (#1036)', async () => {
  const swept: string[] = []
  const sweep = startMergedWorktreeSweep({
    projects: async () => [{ path: '/bad' }, { path: '/good' }],
    log: () => {},
    sweep: async cwd => {
      if (cwd === '/bad') throw new Error('nope')
      swept.push(cwd)
      return { removed: [], failed: [] }
    },
    intervalMs: 60_000,
  })
  await sweep.tick()
  sweep.stop()
  assert.deepEqual(swept, ['/good'])
})

// Against real git, because "is the work still there afterwards" is not a question a fake answers.

const RUN_ID = 'run1'

/** A repo with a session worktree that has a commit of its own on the run branch. */
async function repoWithSessionWork(): Promise<{ repo: string; path: string; branch: string; base: string }> {
  const git = nodeGitRunner()
  // realpath so the mkdtemp path matches what git reports (the /var -> /private/var symlink).
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'framework-merged-')))
  await git(['init'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello, world!</h1>\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-m', 'init'], repo)
  const base = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim()
  const { path, branch } = await addWorktree(repo, { runId: RUN_ID, branch: runBranchName(RUN_ID) }, git)
  await writeFile(join(path, 'index.html'), '<h1>Welcome!</h1>\n')
  await git(['add', '-A'], path)
  await git(['commit', '-m', 'the session did this'], path)
  return { repo, path, branch, base }
}

/** The real branch reader, minus the `gh` call: these tests are about git, and have no remote. */
const localHandoff = (cwd: string, branch: string) => readRunHandoff(cwd, branch, { pr: async () => undefined })

test('a merged session loses its checkout and keeps its branch and commit (#1036)', async () => {
  const { repo, path, branch, base } = await repoWithSessionWork()
  const git = nodeGitRunner()
  try {
    await git(['merge', '--no-ff', '-m', 'merge the session', branch], repo)
    const result = await removeMergedWorktrees(repo, { handoff: localHandoff })

    assert.deepEqual(result.removed, [{ runId: RUN_ID, branch, via: 'branch' }])
    await assert.rejects(() => stat(path), 'the checkout is gone')
    // The half that makes this safe to do automatically.
    assert.equal((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)).trim().length, 40, 'the branch is kept')
    const log = await git(['log', '--format=%s', branch], repo)
    assert.match(log, /the session did this/, 'the commit is still on the branch')
    assert.match(await git(['show', `${base}:index.html`], repo), /Welcome!/, 'and it landed on the base')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('an unmerged session keeps its checkout (#1036)', async () => {
  const { repo, path } = await repoWithSessionWork()
  try {
    assert.deepEqual(await removeMergedWorktrees(repo, { handoff: localHandoff }), { removed: [], failed: [] })
    assert.ok((await stat(path)).isDirectory(), 'the checkout is still there')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a squash-merged branch is not an ancestor of the base, which is why the PR signal exists (#1036)', async () => {
  const { repo, path, branch } = await repoWithSessionWork()
  const git = nodeGitRunner()
  try {
    await git(['merge', '--squash', branch], repo)
    await git(['commit', '-m', 'the session did this (#1)'], repo)

    // The gap, against real git: the work is in the base, and `git branch --merged` says no.
    const state = await localHandoff(repo, branch)
    assert.equal(state?.merged, false, 'a squash merge rewrites the commits, so the branch never becomes an ancestor')
    assert.deepEqual(await removeMergedWorktrees(repo, { handoff: localHandoff }), { removed: [], failed: [] })
    assert.ok((await stat(path)).isDirectory(), 'so the local signal alone would keep this checkout forever')

    // GitHub saying MERGED is what closes it.
    const withPr = async (cwd: string, b: string) => {
      const read = await localHandoff(cwd, b)
      return read ? { ...read, pr: pr('MERGED') } : undefined
    }
    const result = await removeMergedWorktrees(repo, { handoff: withPr })
    assert.deepEqual(result.removed, [{ runId: RUN_ID, branch, via: 'pr' }])
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.equal((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)).trim().length, 40, 'the branch is kept')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('uncommitted work in a landed checkout is committed to the kept branch, not destroyed (#982/#1036)', async () => {
  const { repo, path, branch } = await repoWithSessionWork()
  const git = nodeGitRunner()
  try {
    await git(['merge', '--no-ff', '-m', 'merge the session', branch], repo)
    await writeFile(join(path, 'notes.txt'), 'something the agent had not committed\n')

    const result = await removeMergedWorktrees(repo, { handoff: localHandoff })
    assert.deepEqual(result.failed, [])
    await assert.rejects(() => stat(path), 'the checkout is gone')
    assert.match(await git(['show', `${branch}:notes.txt`], repo), /had not committed/, 'the stray work is on the branch')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
