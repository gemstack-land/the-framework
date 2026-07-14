import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildDashboard } from './dashboard.js'
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

const run = (status: RunMeta['status'], startedAt: string): RunMeta =>
  ({ version: 1, status, id: startedAt, startedAt, updatedAt: startedAt, passes: 0 }) as RunMeta

// A fixed clock so the 14-day activity window is deterministic.
const NOW = () => new Date('2026-07-14T12:00:00Z')

test('buildDashboard rolls up totals, run-status, and per-project counts', async () => {
  const projects = [project('a', '/a', '2026-07-13T00:00:00Z'), project('b', '/b', '2026-07-10T00:00:00Z')]
  const runsByPath: Record<string, RunMeta[]> = {
    '/a': [run('done', '2026-07-14T09:00:00Z'), run('failed', '2026-07-13T09:00:00Z')],
    '/b': [run('done', '2026-07-12T09:00:00Z')],
  }
  const queues: ProjectQueue[] = [
    { projectId: 'a', projectName: 'a', open: 2, total: 3, items: [] },
    { projectId: 'b', projectName: 'b', open: 0, total: 1, items: [] },
  ]
  const data = await buildDashboard(projects, {
    liveMeta: async cwd => (cwd === '/a' ? run('running', '2026-07-14T11:00:00Z') : undefined),
    runs: async cwd => runsByPath[cwd] ?? [],
    queue: async () => queues,
    now: NOW,
  })

  assert.deepEqual(data.totals, { projects: 2, activeRuns: 1, openTodos: 2, totalRuns: 3 })
  assert.deepEqual(data.runsByStatus, { running: 0, done: 2, stopped: 0, failed: 1 })
  assert.equal(data.projects.length, 2)
  const a = data.projects.find(p => p.projectId === 'a')!
  assert.equal(a.runs, 2)
  assert.equal(a.openTodos, 2)
  assert.equal(a.running, true)
  assert.equal(data.projects.find(p => p.projectId === 'b')!.running, false)
})

test('buildDashboard buckets run activity across a 14-day window, oldest-first', async () => {
  const runs = [
    run('done', '2026-07-14T09:00:00Z'), // today
    run('done', '2026-07-14T20:00:00Z'), // today (second)
    run('failed', '2026-07-08T09:00:00Z'), // within window
    run('done', '2026-06-01T09:00:00Z'), // older than 14 days -> dropped
  ]
  const data = await buildDashboard([project('a', '/a')], {
    liveMeta: async () => undefined,
    runs: async () => runs,
    queue: async () => [],
    now: NOW,
  })

  assert.equal(data.activity.length, 14)
  assert.equal(data.activity[0]!.date, '2026-07-01') // oldest bar
  assert.equal(data.activity.at(-1)!.date, '2026-07-14') // today, last
  assert.equal(data.activity.at(-1)!.count, 2)
  assert.equal(data.activity.find(d => d.date === '2026-07-08')!.count, 1)
  // The June run falls outside the window and is not counted anywhere.
  assert.equal(data.activity.reduce((n, d) => n + d.count, 0), 3)
})
