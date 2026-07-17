import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ActivityTracker, postActivityDiscord, startActivityWatcher } from './activity-watcher.js'
import type { Activity } from './activity.js'
import type { ProjectSummary } from './projects.js'

const started = (runId: string, project = 'p', title?: string): Activity => ({
  projectId: project,
  projectName: project,
  runId,
  kind: 'started',
  ...(title ? { title } : {}),
})
const finished = (runId: string, status: Activity['status'] = 'done', project = 'p', title?: string): Activity => ({
  projectId: project,
  projectName: project,
  runId,
  kind: 'finished',
  status,
  ...(title ? { title } : {}),
})

test('ActivityTracker seeds a baseline on the first poll, then returns only new transitions', () => {
  const tracker = new ActivityTracker()
  // First poll = the runs already going/finished at start-up: baseline, nothing announced.
  assert.deepEqual(tracker.observe([started('r1')]), [])
  // The same run finishing is a new key -> announced.
  assert.deepEqual(tracker.observe([finished('r1')]).map(i => i.kind), ['finished'])
  // Nothing new -> empty.
  assert.deepEqual(tracker.observe([finished('r1')]), [])
})

test('postActivityDiscord posts a started run with its project and title', async () => {
  let body: unknown
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postActivityDiscord('https://discord/hook', [started('r1', 'gemstack', 'add cart')], fetchImpl)
  const content = (body as { content: string }).content
  assert.match(content, /gemstack/)
  assert.match(content, /started/)
  assert.match(content, /add cart/)
})

test('postActivityDiscord marks a failed run distinctly from a done one', async () => {
  const contents: string[] = []
  const fetchImpl = (async (_url, init) => {
    contents.push(JSON.parse(String(init!.body)).content)
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postActivityDiscord('https://discord/hook', [finished('r1', 'done', 'p', 'ship it')], fetchImpl)
  await postActivityDiscord('https://discord/hook', [finished('r2', 'failed', 'p', 'broke it')], fetchImpl)
  assert.match(contents[0]!, /✅/)
  assert.match(contents[1]!, /❌/)
})

test('postActivityDiscord summarizes multiple items and skips the call when there are none', async () => {
  const calls: string[] = []
  const fetchImpl = (async (_url, init) => {
    calls.push(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postActivityDiscord('https://discord/hook', [started('r1'), finished('r2')], fetchImpl)
  assert.match(JSON.parse(calls[0]!).content, /2 run updates/)
  await postActivityDiscord('https://discord/hook', [], fetchImpl)
  assert.equal(calls.length, 1) // empty -> no second POST
})

test('startActivityWatcher announces only transitions that appear after the first poll', async () => {
  const projects = async (): Promise<ProjectSummary[]> => [{ id: 'a', path: '/a', name: 'a', activated: true }]
  let current: Activity[] = [started('r1')]
  const announced: string[][] = []
  const watcher = startActivityWatcher({
    projects,
    build: async () => current,
    onNew: items => void announced.push(items.map(i => i.kind)),
    intervalMs: 1_000_000, // effectively disable the timer; drive via poll()
  })
  try {
    // The constructor fires an immediate baseline poll (r1 already started) — let it settle.
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(announced, []) // baseline announces nothing
    current = [finished('r1')]
    await watcher.poll() // r1 finishing is a new key -> announced
    assert.deepEqual(announced, [['finished']])
  } finally {
    watcher.stop()
  }
})
