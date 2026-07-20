import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildInterventions, interventionKey, type OpenPr } from './interventions.js'
import type { RunHandoff } from './run-handoff.js'
import type { ProjectSummary } from './projects.js'
import type { LiveRun, RunMeta } from '../store/index.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true })

/** No paused run anywhere — keeps the PR-only tests hermetic (no disk read). */
const noRuns = async (): Promise<LiveRun[]> => []

/** A live run in its own worktree (#738), which is what the reader now returns. */
const live = (meta: RunMeta, cwd = '/a/.the-framework/worktrees/r1'): LiveRun => ({ ...meta, cwd })

const runningMeta = (over: Partial<RunMeta> = {}): RunMeta => ({
  version: 1,
  status: 'running',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  passes: 0,
  ...over,
})

test('buildInterventions rolls up open non-draft PRs across projects, newest first', async () => {
  const prsByPath: Record<string, OpenPr[]> = {
    '/a': [
      { number: 7, title: 'add cart', url: 'u7', isDraft: false, createdAt: '2026-07-10T00:00:00Z' },
      { number: 8, title: 'wip spike', url: 'u8', isDraft: true, createdAt: '2026-07-12T00:00:00Z' }, // draft -> excluded
    ],
    '/b': [{ number: 3, title: 'fix login', url: 'u3', isDraft: false, createdAt: '2026-07-15T00:00:00Z' }],
    '/c': [], // no open PRs -> contributes nothing
  }
  const prs = async (cwd: string): Promise<OpenPr[]> => prsByPath[cwd] ?? []
  const items = await buildInterventions([project('a', '/a'), project('b', '/b'), project('c', '/c')], { prs, liveRuns: noRuns })

  // Newest PR first; the draft is gone.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, number: i.number, title: i.title })),
    [
      { project: 'b', number: 3, title: 'fix login' },
      { project: 'a', number: 7, title: 'add cart' },
    ],
  )
  assert.ok(items.every(i => i.kind === 'pr'))
})

test('buildInterventions skips a project whose PR lookup throws', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> => {
    if (cwd === '/boom') throw new Error('gh exploded')
    return [{ number: 1, title: 'ok', url: 'u1', isDraft: false }]
  }
  const items = await buildInterventions([project('boom', '/boom'), project('ok', '/ok')], { prs, liveRuns: noRuns })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
})

test('buildInterventions returns [] when nothing is open anywhere', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  assert.deepEqual(await buildInterventions([project('a', '/a')], { prs, liveRuns: noRuns }), [])
})

test('buildInterventions dedupes a PR shared by two registered projects (same repo), keeping one', async () => {
  const shared: OpenPr = { number: 285, title: 'release', url: 'https://gh/pr/285', isDraft: false, createdAt: '2026-07-05T00:00:00Z' }
  const prs = async (): Promise<OpenPr[]> => [shared] // both projects resolve to the same repo
  const items = await buildInterventions([project('root', '/repo'), project('sub', '/repo/packages/x')], { prs, liveRuns: noRuns })
  assert.deepEqual(items.map(i => i.number), [285])
})

const noPrs = async (): Promise<OpenPr[]> => []

test('buildInterventions adds an awaiting item for a running run parked on a choice (#636)', async () => {
  const liveRuns = async (cwd: string): Promise<LiveRun[]> =>
    cwd === '/a' ? [live(runningMeta({ pendingChoice: { id: 'gate-1', title: 'Cache the auth store?' } }))] : []
  const items = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs: noPrs, liveRuns })

  assert.equal(items.length, 1)
  assert.deepEqual(
    { kind: items[0]!.kind, project: items[0]!.projectId, title: items[0]!.title, awaitId: items[0]!.awaitId },
    { kind: 'awaiting', project: 'a', title: 'Cache the auth store?', awaitId: 'gate-1' },
  )
})

test('buildInterventions ignores a pendingChoice on a run that is no longer running', async () => {
  const liveRuns = async (): Promise<LiveRun[]> =>
    [live(runningMeta({ status: 'done', pendingChoice: { id: 'gate-1', title: 'stale' } }))]
  assert.deepEqual(await buildInterventions([project('a', '/a')], { prs: noPrs, liveRuns }), [])
})

test('buildInterventions links an awaiting item to the dashboard URL when given, else empty', async () => {
  const liveRuns = async (): Promise<LiveRun[]> => [live(runningMeta({ pendingChoice: { id: 'g', title: 'q?' } }))]
  const withUrl = await buildInterventions([project('a', '/a')], { prs: noPrs, liveRuns, dashboardUrl: 'http://localhost:4200' })
  assert.equal(withUrl[0]!.url, 'http://localhost:4200')
  const withoutUrl = await buildInterventions([project('a', '/a')], { prs: noPrs, liveRuns })
  assert.equal(withoutUrl[0]!.url, '')
})

test('buildInterventions surfaces PRs and awaiting runs together, newest first', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> =>
    cwd === '/a' ? [{ number: 5, title: 'pr', url: 'u5', isDraft: false, createdAt: '2026-07-10T00:00:00Z' }] : []
  const liveRuns = async (cwd: string): Promise<LiveRun[]> =>
    cwd === '/b' ? [live(runningMeta({ updatedAt: '2026-07-16T00:00:00Z', pendingChoice: { id: 'g', title: 'q?' } }))] : []
  const items = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs, liveRuns })
  assert.deepEqual(items.map(i => i.kind), ['awaiting', 'pr']) // awaiting is newer
})

test('interventionKey is the url for a PR and project+gate for an awaiting run', () => {
  assert.equal(
    interventionKey({ projectId: 'a', projectName: 'a', kind: 'pr', title: 't', url: 'https://gh/pr/1', number: 1 }),
    'https://gh/pr/1',
  )
  assert.equal(
    interventionKey({ projectId: 'a', projectName: 'a', kind: 'awaiting', title: 't', url: '', awaitId: 'g1' }),
    'awaiting:a:g1',
  )
})

// #860: a finished run whose branch still holds unpushed, unmerged commits.

const doneMeta = (over: Partial<RunMeta> = {}): RunMeta => ({
  version: 1,
  status: 'done',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T01:00:00Z',
  passes: 0,
  branch: 'the-framework/add-cart',
  intent: 'add the cart',
  ...over,
})

/** A branch with work on it that never left the machine. */
const waiting = (over: Partial<RunHandoff> = {}): RunHandoff => ({
  branch: 'the-framework/add-cart',
  exists: true,
  base: 'main',
  commits: [{ sha: 'abc1234', short: 'abc1234', subject: 'add the cart' }],
  files: [],
  insertions: 0,
  deletions: 0,
  empty: false,
  hasRemote: true,
  pushed: false,
  merged: false,
  ...over,
})

/** Only the unpushed source: no PRs, no paused runs. */
const onlyUnpushed = (runs: RunMeta[], handoff: (cwd: string, branch: string) => Promise<RunHandoff | undefined>) => ({
  prs: async () => [],
  liveRuns: noRuns,
  runs: async () => runs,
  handoff,
})

test('a finished run with unpushed commits lands on the queue (#860)', async () => {
  const items = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta()], async () => waiting()),
  )

  assert.equal(items.length, 1)
  assert.equal(items[0]?.kind, 'unpushed')
  assert.equal(items[0]?.title, 'add the cart', 'what was asked, not the branch name')
  assert.equal(items[0]?.branch, 'the-framework/add-cart')
  assert.equal(items[0]?.commits, 1)
  assert.equal(items[0]?.runId, 'r1')
})

test('nothing is waiting when the work already went somewhere (#860)', async () => {
  // Each of these is a reason it is NOT waiting on a human.
  const cases: [string, Partial<RunHandoff>][] = [
    ['already pushed', { pushed: true }],
    ['already merged', { merged: true }],
    ['the session wrote nothing', { empty: true, commits: [] }],
    ['the branch is gone', { exists: false }],
    ['there is nowhere to push', { hasRemote: false }],
  ]
  for (const [why, over] of cases) {
    const items = await buildInterventions(
      [project('a', '/a')],
      onlyUnpushed([doneMeta()], async () => waiting(over)),
    )
    assert.deepEqual(items, [], `should not be surfaced: ${why}`)
  }
})

test('a still-running run is not unpushed work (#860)', async () => {
  // It is still writing; the overview already shows it.
  const items = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta({ status: 'running' })], async () => waiting()),
  )
  assert.deepEqual(items, [])
})

test('an unreadable branch is skipped rather than throwing (#860)', async () => {
  const items = await buildInterventions(
    [project('a', '/a')],
    onlyUnpushed([doneMeta()], async () => {
      throw new Error('not a repo')
    }),
  )
  assert.deepEqual(items, [])
})

test('only the most recent finished runs are inspected (#860)', async () => {
  // Each inspection costs several git reads on a poll, and work sitting unpushed for dozens of
  // runs is not news.
  const runs = Array.from({ length: 12 }, (_, i) =>
    doneMeta({ id: `r${i}`, startedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`, branch: `b${i}` }),
  )
  const inspected: string[] = []
  const items = await buildInterventions(
    [project('a', '/a')],
    { ...onlyUnpushed(runs, async (_cwd, branch) => (inspected.push(branch), waiting({ branch }))), handoffLimit: 3 },
  )

  assert.equal(inspected.length, 3)
  assert.deepEqual(inspected, ['b11', 'b10', 'b9'], 'the newest three, by start time')
  assert.equal(items.length, 3)
})

test('unpushed items key on the run, so each notifies once (#860)', () => {
  const base = { projectId: 'p', projectName: 'p', kind: 'unpushed' as const, title: 't', url: '' }
  assert.equal(interventionKey({ ...base, runId: 'r1' }), 'unpushed:p:r1')
  assert.notEqual(interventionKey({ ...base, runId: 'r1' }), interventionKey({ ...base, runId: 'r2' }))
  // And never collides with the other kinds, whose url is the same shared dashboard URL.
  assert.notEqual(
    interventionKey({ ...base, runId: 'r1' }),
    interventionKey({ ...base, kind: 'awaiting', awaitId: 'r1' }),
  )
})
