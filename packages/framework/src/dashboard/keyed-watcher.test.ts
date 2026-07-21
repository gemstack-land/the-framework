import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { SeenTracker, startKeyedWatcher } from './keyed-watcher.js'
import { activityKey, type Activity } from './activity.js'
import { interventionKey, type Intervention } from './interventions.js'
import type { ProjectSummary } from './projects.js'

const pr = (n: number, url: string, project = 'p'): Intervention => ({
  projectId: project,
  projectName: project,
  kind: 'pr',
  number: n,
  title: `pr ${n}`,
  url,
})

const started = (runId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'started', runId })
const finished = (runId: string): Activity => ({ projectId: 'p', projectName: 'p', kind: 'finished', runId, status: 'done' })

test('SeenTracker seeds a baseline on the first poll, then returns only new items', () => {
  const tracker = new SeenTracker(interventionKey)
  // First poll = the queue that already existed at start-up: baseline, nothing announced.
  assert.deepEqual(tracker.observe([pr(1, 'u1')]), [])
  // A new PR appears next poll -> just that one.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')]).map(i => i.number), [2])
  // Nothing new -> empty.
  assert.deepEqual(tracker.observe([pr(1, 'u1'), pr(2, 'u2')]), [])
})

test('SeenTracker keys on the caller\'s identity, so a run started and finished are two announcements', () => {
  const tracker = new SeenTracker(activityKey)
  assert.deepEqual(tracker.observe([started('r1')]), [])
  // The same run finishing is a new key -> announced.
  assert.deepEqual(tracker.observe([finished('r1')]).map(i => i.kind), ['finished'])
  assert.deepEqual(tracker.observe([finished('r1')]), [])
})

test('startKeyedWatcher announces only items that appear after the first poll', async () => {
  const projects = async (): Promise<ProjectSummary[]> => [{ id: 'a', path: '/a', name: 'a', activated: true }]
  let current: Intervention[] = [pr(1, 'u1')]
  const announced: number[][] = []
  const watcher = startKeyedWatcher({
    projects,
    build: async () => current,
    keyOf: interventionKey,
    onNew: items => void announced.push(items.map(i => i.number!)),
    intervalMs: 1_000_000, // effectively disable the timer; drive via poll()
  })
  try {
    // Construction fires an immediate baseline poll (u1 already open) — let it settle.
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(announced, []) // baseline announces nothing
    current = [pr(1, 'u1'), pr(2, 'u2')]
    await watcher.poll() // u2 is new -> announced
    assert.deepEqual(announced, [[2]])
  } finally {
    watcher.stop()
  }
})

test('startKeyedWatcher yields no new items when the scan or the projection fails', async () => {
  const announced: unknown[][] = []
  const watcher = startKeyedWatcher<Intervention>({
    projects: async () => {
      throw new Error('registry unreadable')
    },
    build: async () => {
      throw new Error('projection failed')
    },
    keyOf: interventionKey,
    onNew: items => void announced.push(items),
    intervalMs: 1_000_000,
  })
  try {
    await watcher.poll()
    assert.deepEqual(announced, [])
  } finally {
    watcher.stop()
  }
})
