import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { GitRunner } from './project.js'
import {
  assessRepo,
  planMaintenanceSweep,
  maintainSweep,
  readMaintenanceState,
  writeMaintenanceState,
  mergeMaintenanceState,
  maintenanceDue,
  DEFAULT_MAINTENANCE_INTERVAL_MS,
  type MaintenanceFs,
  type RepoReview,
  type SweepDeps,
} from './maintenance.js'

/** In-memory {@link MaintenanceFs}. */
function memFs(): { fs: MaintenanceFs; files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    fs: {
      async read(path) {
        const v = files.get(path)
        if (v === undefined) throw new Error('ENOENT')
        return v
      },
      async write(path, contents) {
        files.set(path, contents)
      },
      async mkdir() {},
    },
  }
}

/** A fake GitRunner keyed by repo path: HEAD + a rev-list count (or a throw). */
function fakeGit(repos: Record<string, { head: string; newCommits?: number; revListThrows?: boolean } | undefined>): GitRunner {
  return async (args, cwd) => {
    const repo = repos[cwd]
    if (!repo) throw new Error('not a git repo')
    if (args[0] === 'rev-parse') return repo.head + '\n'
    if (args[0] === 'rev-list') {
      if (repo.revListThrows) throw new Error('bad revision')
      return String(repo.newCommits ?? 0) + '\n'
    }
    throw new Error('unexpected git args: ' + args.join(' '))
  }
}

test('assessRepo baselines a first-seen repo (records nothing retroactively)', async () => {
  const { fs } = memFs()
  const git = fakeGit({ '/a': { head: 'aaaaaaaa' } })
  const r = await assessRepo('/a', git, fs)
  assert.equal(r.action, 'baseline')
  assert.equal(r.headSha, 'aaaaaaaa')
  assert.equal(r.newCommits, 0)
})

test('assessRepo skips an up-to-date repo and reviews one with new commits', async () => {
  const { fs } = memFs()
  await writeMaintenanceState('/a', { reviewedSha: 'aaaaaaaa' }, fs)
  await writeMaintenanceState('/b', { reviewedSha: 'old00000' }, fs)
  const git = fakeGit({ '/a': { head: 'aaaaaaaa' }, '/b': { head: 'bbbbbbbb', newCommits: 3 } })

  const a = await assessRepo('/a', git, fs)
  assert.equal(a.action, 'skip')
  assert.equal(a.newCommits, 0)

  const b = await assessRepo('/b', git, fs)
  assert.equal(b.action, 'review')
  assert.equal(b.newCommits, 3)
  assert.equal(b.reviewedSha, 'old00000')
})

test('assessRepo errors on a non-repo and re-reviews when history was rewritten', async () => {
  const { fs } = memFs()
  await writeMaintenanceState('/gone', { reviewedSha: 'deadbeef' }, fs)
  const git = fakeGit({ '/gone': { head: 'cccccccc', revListThrows: true } })

  const missing = await assessRepo('/missing', git, fs) // not in the fake -> git throws
  assert.equal(missing.action, 'error')

  const rewritten = await assessRepo('/gone', git, fs)
  assert.equal(rewritten.action, 'review')
  assert.match(rewritten.note ?? '', /history changed/)
})

test('readMaintenanceState is forgiving; write/read round-trips', async () => {
  const { fs, files } = memFs()
  assert.deepEqual(await readMaintenanceState('/a', fs), {}) // absent
  files.set((await import('./maintenance.js')).maintenanceStatePath('/a'), 'not json')
  assert.deepEqual(await readMaintenanceState('/a', fs), {}) // malformed

  await writeMaintenanceState('/a', { reviewedSha: 'abc', reviewedAt: '2026-01-01T00:00:00Z' }, fs)
  assert.deepEqual(await readMaintenanceState('/a', fs), { reviewedSha: 'abc', reviewedAt: '2026-01-01T00:00:00Z' })
})

test('planMaintenanceSweep tags each review with its registry id', async () => {
  const { fs } = memFs()
  const git = fakeGit({ '/a': { head: 'aaaaaaaa' }, '/b': { head: 'bbbbbbbb' } })
  const plan = await planMaintenanceSweep([{ id: 'a-1', path: '/a' }, { id: 'b-1', path: '/b' }], git, fs)
  assert.deepEqual(plan.map(r => r.id), ['a-1', 'b-1'])
})

/** A SweepDeps that records calls, with a run() outcome per path. */
function recordingDeps(outcome: (path: string) => boolean): {
  deps: SweepDeps
  ran: string[]
  recorded: { path: string; sha: string | undefined }[]
} {
  const ran: string[] = []
  const recorded: { path: string; sha: string | undefined }[] = []
  return {
    ran,
    recorded,
    deps: {
      run: async (review: RepoReview) => {
        ran.push(review.path)
        return outcome(review.path)
      },
      record: async (path, state) => {
        recorded.push({ path, sha: state.reviewedSha })
      },
      log: () => {},
      now: () => '2026-02-02T00:00:00Z',
    },
  }
}

test('maintainSweep baselines without running, records a successful review, retries a failure', async () => {
  const reviews: RepoReview[] = [
    { path: '/base', headSha: 'h0', newCommits: 0, action: 'baseline' },
    { path: '/ok', headSha: 'h1', reviewedSha: 'r1', newCommits: 2, action: 'review' },
    { path: '/fail', headSha: 'h2', reviewedSha: 'r2', newCommits: 1, action: 'review' },
    { path: '/clean', headSha: 'h3', newCommits: 0, action: 'skip' },
  ]
  const { deps, ran, recorded } = recordingDeps(path => path === '/ok') // only /ok succeeds
  const summary = await maintainSweep(reviews, deps)

  assert.deepEqual(ran, ['/ok', '/fail']) // baseline + skip never run
  assert.deepEqual(recorded, [
    { path: '/base', sha: 'h0' }, // baseline records HEAD
    { path: '/ok', sha: 'h1' }, // success records HEAD
    // /fail is NOT recorded -> retried next sweep
  ])
  assert.deepEqual(summary, { reviewed: 1, baselined: 1, skipped: 1, failed: 1, pending: 0 })
})

test('maintainSweep honors maxRepos, leaving the rest pending', async () => {
  const reviews: RepoReview[] = [
    { path: '/a', headSha: 'a', reviewedSha: 'x', newCommits: 1, action: 'review' },
    { path: '/b', headSha: 'b', reviewedSha: 'y', newCommits: 1, action: 'review' },
    { path: '/c', headSha: 'c', reviewedSha: 'z', newCommits: 1, action: 'review' },
  ]
  const { deps, ran } = recordingDeps(() => true)
  const summary = await maintainSweep(reviews, { ...deps, maxRepos: 2 })
  assert.deepEqual(ran, ['/a', '/b'])
  assert.equal(summary.reviewed, 2)
  assert.equal(summary.pending, 1)
})

test('a repo nobody has swept yet is due immediately (#882)', () => {
  // The whole point of #882: a late-adopting repo has a history no session ever saw. Note the
  // commit-delta sweep (#298) does the opposite here, baselining it at HEAD and never looking back.
  assert.equal(maintenanceDue({}, Date.parse('2026-07-20T12:00:00Z')), true)
})

test('a freshly swept repo is left alone until the interval is up (#882)', () => {
  const swept = { sweptAt: '2026-07-20T12:00:00Z' }
  const day = 24 * 60 * 60 * 1000
  assert.equal(maintenanceDue(swept, Date.parse('2026-07-21T12:00:00Z')), false)
  assert.equal(maintenanceDue(swept, Date.parse('2026-07-27T11:59:59Z')), false)
  // Exactly an interval later counts as due, so a weekly sweep does not drift a tick later each week.
  assert.equal(maintenanceDue(swept, Date.parse('2026-07-20T12:00:00Z') + DEFAULT_MAINTENANCE_INTERVAL_MS), true)
})

test('the sweep interval is a week (#882)', () => {
  assert.equal(DEFAULT_MAINTENANCE_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000)
})

test('a corrupted sweep timestamp means due, not never (#882)', () => {
  // Falling the other way would drop the repo out of the schedule permanently, and silently.
  assert.equal(maintenanceDue({ sweptAt: 'last tuesday' }, Date.parse('2026-07-20T12:00:00Z')), true)
})

test('the two maintenance schedules do not overwrite each other (#882)', async () => {
  // The file is written wholesale by both features, so #298's sweep and #882's would each reset
  // the other's schedule without the merge.
  const { fs } = memFs()
  await writeMaintenanceState('/repo', { reviewedSha: 'abc123', reviewedAt: '2026-07-01T00:00:00Z' }, fs)
  await mergeMaintenanceState('/repo', { sweptAt: '2026-07-20T12:00:00Z' }, fs)
  assert.deepEqual(await readMaintenanceState('/repo', fs), {
    reviewedSha: 'abc123',
    reviewedAt: '2026-07-01T00:00:00Z',
    sweptAt: '2026-07-20T12:00:00Z',
  })

  // ...and the same in the other direction, which is the path `framework maintain` takes.
  await mergeMaintenanceState('/repo', { reviewedSha: 'def456', reviewedAt: '2026-07-21T00:00:00Z' }, fs)
  const after = await readMaintenanceState('/repo', fs)
  assert.equal(after.sweptAt, '2026-07-20T12:00:00Z')
  assert.equal(after.reviewedSha, 'def456')
})

test('mergeMaintenanceState writes a first state when there is no file yet (#882)', async () => {
  const { fs } = memFs()
  await mergeMaintenanceState('/fresh', { sweptAt: '2026-07-20T12:00:00Z' }, fs)
  assert.deepEqual(await readMaintenanceState('/fresh', fs), { sweptAt: '2026-07-20T12:00:00Z' })
})
