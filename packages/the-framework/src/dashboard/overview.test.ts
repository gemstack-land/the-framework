import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildOverview, buildRecentRuns } from './overview.js'
import type { ProjectSummary } from './projects.js'
import type { ProjectQueue } from './queue.js'
import type { RunMeta } from '../store/index.js'

const project = (id: string, path: string, lastActivityAt?: string): ProjectSummary => ({
  id,
  path,
  name: id,
  activated: true,
  ...(lastActivityAt ? { lastActivityAt } : {}),
})

const meta = (status: RunMeta['status'], intent: string, updatedAt: string): RunMeta =>
  ({ version: 1, status, id: 'r', startedAt: updatedAt, updatedAt, passes: 0, intent }) as RunMeta

test('buildOverview surfaces only running runs, most-recently-updated first', async () => {
  const metas: Record<string, RunMeta> = {
    '/a': meta('running', 'build the API', '2026-07-13T10:00:00Z'),
    '/b': meta('done', 'finished thing', '2026-07-13T11:00:00Z'),
    '/c': meta('running', 'build the UI', '2026-07-13T12:00:00Z'),
  }
  const overview = await buildOverview([project('a', '/a'), project('b', '/b'), project('c', '/c')], {
    liveRuns: async cwd => (metas[cwd] ? [{ ...metas[cwd]!, cwd }] : []),
    queue: async () => [],
  })
  assert.deepEqual(
    overview.active.map(r => ({ id: r.projectId, intent: r.intent })),
    [
      { id: 'c', intent: 'build the UI' }, // newer updatedAt first
      { id: 'a', intent: 'build the API' },
    ],
  )
})

test('buildOverview sums the open queue and lists recent projects newest-first (capped at 5)', async () => {
  const projects = Array.from({ length: 7 }, (_, i) =>
    project(`p${i}`, `/p${i}`, `2026-07-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
  )
  const queues: ProjectQueue[] = [
    { projectId: 'p0', projectName: 'p0', open: 3, total: 4, items: [] },
    { projectId: 'p1', projectName: 'p1', open: 2, total: 2, items: [] },
  ]
  const overview = await buildOverview(projects, { liveRuns: async () => [], queue: async () => queues })
  assert.equal(overview.active.length, 0)
  assert.equal(overview.queueOpen, 5)
  assert.equal(overview.recent.length, 5)
  assert.deepEqual(
    overview.recent.map(r => r.projectId),
    ['p6', 'p5', 'p4', 'p3', 'p2'], // newest-first, top 5
  )
})

test('buildOverview omits projects with no activity from recent', async () => {
  const overview = await buildOverview([project('a', '/a'), project('b', '/b', '2026-07-13T00:00:00Z')], {
    liveRuns: async () => [],
    queue: async () => [],
  })
  assert.deepEqual(overview.recent.map(r => r.projectId), ['b'])
})

const run = (id: string, startedAt: string): RunMeta =>
  ({ version: 1, status: 'done', id, startedAt, updatedAt: startedAt, passes: 0 }) as RunMeta

test('buildRecentRuns pools every project newest-first and tags each with its project', async () => {
  const runs: Record<string, RunMeta[]> = {
    '/a': [run('a2', '2026-07-13T12:00:00Z'), run('a1', '2026-07-13T09:00:00Z')],
    '/b': [run('b1', '2026-07-13T11:00:00Z')],
  }
  const recent = await buildRecentRuns([project('alpha', '/a'), project('beta', '/b')], {
    runs: async cwd => runs[cwd] ?? [],
  })
  assert.deepEqual(
    recent.map(r => ({ project: r.projectName, id: r.run.id })),
    [
      { project: 'alpha', id: 'a2' },
      { project: 'beta', id: 'b1' },
      { project: 'alpha', id: 'a1' },
    ],
  )
})

test('buildRecentRuns tolerates a project whose runs cannot be read', async () => {
  const recent = await buildRecentRuns([project('ok', '/ok'), project('bad', '/bad')], {
    runs: async cwd => {
      if (cwd === '/bad') throw new Error('unreadable')
      return [run('x', '2026-07-13T10:00:00Z')]
    },
  })
  assert.deepEqual(recent.map(r => r.run.id), ['x'])
})
