import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildInterventions, interventionKey, type OpenPr } from './interventions.js'
import type { ProjectSummary } from './projects.js'
import type { RunMeta } from '../store/index.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true })

/** No paused run anywhere — keeps the PR-only tests hermetic (no disk read). */
const noRuns = async (): Promise<RunMeta | undefined> => undefined

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
  const items = await buildInterventions([project('a', '/a'), project('b', '/b'), project('c', '/c')], { prs, liveMeta: noRuns })

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
  const items = await buildInterventions([project('boom', '/boom'), project('ok', '/ok')], { prs, liveMeta: noRuns })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
})

test('buildInterventions returns [] when nothing is open anywhere', async () => {
  const prs = async (): Promise<OpenPr[]> => []
  assert.deepEqual(await buildInterventions([project('a', '/a')], { prs, liveMeta: noRuns }), [])
})

test('buildInterventions dedupes a PR shared by two registered projects (same repo), keeping one', async () => {
  const shared: OpenPr = { number: 285, title: 'release', url: 'https://gh/pr/285', isDraft: false, createdAt: '2026-07-05T00:00:00Z' }
  const prs = async (): Promise<OpenPr[]> => [shared] // both projects resolve to the same repo
  const items = await buildInterventions([project('root', '/repo'), project('sub', '/repo/packages/x')], { prs, liveMeta: noRuns })
  assert.deepEqual(items.map(i => i.number), [285])
})

const noPrs = async (): Promise<OpenPr[]> => []

test('buildInterventions adds an awaiting item for a running run parked on a choice (#636)', async () => {
  const liveMeta = async (cwd: string): Promise<RunMeta | undefined> =>
    cwd === '/a' ? runningMeta({ pendingChoice: { id: 'gate-1', title: 'Cache the auth store?' } }) : undefined
  const items = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs: noPrs, liveMeta })

  assert.equal(items.length, 1)
  assert.deepEqual(
    { kind: items[0]!.kind, project: items[0]!.projectId, title: items[0]!.title, awaitId: items[0]!.awaitId },
    { kind: 'awaiting', project: 'a', title: 'Cache the auth store?', awaitId: 'gate-1' },
  )
})

test('buildInterventions ignores a pendingChoice on a run that is no longer running', async () => {
  const liveMeta = async (): Promise<RunMeta | undefined> =>
    runningMeta({ status: 'done', pendingChoice: { id: 'gate-1', title: 'stale' } })
  assert.deepEqual(await buildInterventions([project('a', '/a')], { prs: noPrs, liveMeta }), [])
})

test('buildInterventions links an awaiting item to the dashboard URL when given, else empty', async () => {
  const liveMeta = async (): Promise<RunMeta | undefined> => runningMeta({ pendingChoice: { id: 'g', title: 'q?' } })
  const withUrl = await buildInterventions([project('a', '/a')], { prs: noPrs, liveMeta, dashboardUrl: 'http://localhost:4200' })
  assert.equal(withUrl[0]!.url, 'http://localhost:4200')
  const withoutUrl = await buildInterventions([project('a', '/a')], { prs: noPrs, liveMeta })
  assert.equal(withoutUrl[0]!.url, '')
})

test('buildInterventions surfaces PRs and awaiting runs together, newest first', async () => {
  const prs = async (cwd: string): Promise<OpenPr[]> =>
    cwd === '/a' ? [{ number: 5, title: 'pr', url: 'u5', isDraft: false, createdAt: '2026-07-10T00:00:00Z' }] : []
  const liveMeta = async (cwd: string): Promise<RunMeta | undefined> =>
    cwd === '/b' ? runningMeta({ updatedAt: '2026-07-16T00:00:00Z', pendingChoice: { id: 'g', title: 'q?' } }) : undefined
  const items = await buildInterventions([project('a', '/a'), project('b', '/b')], { prs, liveMeta })
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
