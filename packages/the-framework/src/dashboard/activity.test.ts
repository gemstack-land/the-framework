import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildActivity, activityKey, pickNewActivity, type Activity } from './activity.js'
import type { ProjectSummary } from './projects.js'
import type { RunMeta } from '../store/index.js'

const project = (id: string, path: string): ProjectSummary => ({ id, path, name: id, activated: true })

const run = (over: Partial<RunMeta> = {}): RunMeta => ({
  version: 1,
  status: 'running',
  id: 'r1',
  startedAt: '2026-07-16T00:00:00Z',
  updatedAt: '2026-07-16T00:00:00Z',
  passes: 0,
  ...over,
})

test('buildActivity maps a running run to started and a terminal run to finished', async () => {
  const runsByPath: Record<string, RunMeta[]> = {
    '/a': [run({ id: 'r1', status: 'running', intent: 'add cart', updatedAt: '2026-07-16T03:00:00Z' })],
    '/b': [run({ id: 'r2', status: 'done', intent: 'fix login', updatedAt: '2026-07-16T01:00:00Z' })],
  }
  const readRuns = async (cwd: string): Promise<RunMeta[]> => runsByPath[cwd] ?? []
  const items = await buildActivity([project('a', '/a'), project('b', '/b')], { readRuns })

  // Newest first.
  assert.deepEqual(
    items.map(i => ({ project: i.projectId, kind: i.kind, title: i.title, status: i.status })),
    [
      { project: 'a', kind: 'started', title: 'add cart', status: undefined },
      { project: 'b', kind: 'finished', title: 'fix login', status: 'done' },
    ],
  )
})

test('buildActivity carries the terminal status so a stop reads differently from a done', async () => {
  const readRuns = async (): Promise<RunMeta[]> => [run({ status: 'stopped', updatedAt: '2026-07-16T02:00:00Z' })]
  const items = await buildActivity([project('a', '/a')], { readRuns })
  assert.deepEqual({ kind: items[0]!.kind, status: items[0]!.status }, { kind: 'finished', status: 'stopped' })
})

test('buildActivity emits one item per run across a project history', async () => {
  const readRuns = async (): Promise<RunMeta[]> => [
    run({ id: 'live', status: 'running', updatedAt: '2026-07-16T05:00:00Z' }),
    run({ id: 'old', status: 'done', updatedAt: '2026-07-15T00:00:00Z' }),
  ]
  const items = await buildActivity([project('a', '/a')], { readRuns })
  assert.deepEqual(items.map(i => [i.runId, i.kind]), [['live', 'started'], ['old', 'finished']])
})

test('buildActivity caps each project to the most recent runs', async () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    run({ id: `r${i}`, status: 'done', updatedAt: `2026-07-16T00:${String(i).padStart(2, '0')}:00Z` }),
  )
  const readRuns = async (): Promise<RunMeta[]> => many
  const items = await buildActivity([project('a', '/a')], { readRuns })
  assert.equal(items.length, 20)
})

test('buildActivity skips a project whose run read throws', async () => {
  const readRuns = async (cwd: string): Promise<RunMeta[]> => {
    if (cwd === '/boom') throw new Error('disk exploded')
    return [run({ id: 'ok', status: 'done' })]
  }
  const items = await buildActivity([project('boom', '/boom'), project('ok', '/ok')], { readRuns })
  assert.deepEqual(items.map(i => i.projectId), ['ok'])
})

test('activityKey separates a run start from its finish', () => {
  const base = { projectId: 'a', projectName: 'a', runId: 'r1' } as const
  assert.equal(activityKey({ ...base, kind: 'started' }), 'started:a:r1')
  assert.equal(activityKey({ ...base, kind: 'finished' }), 'finished:a:r1')
})

test('pickNewActivity returns only items whose key is unseen', () => {
  const started: Activity = { projectId: 'a', projectName: 'a', runId: 'r1', kind: 'started' }
  const finished: Activity = { projectId: 'a', projectName: 'a', runId: 'r1', kind: 'finished' }
  const seen = new Set([activityKey(started)])
  // The same run finishing is a new key, so it is picked up even though its start was already seen.
  assert.deepEqual(pickNewActivity(seen, [started, finished]), [finished])
})
