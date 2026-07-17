import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { InterventionTracker, postDiscord, startInterventionWatcher } from './intervention-watcher.js'
import type { Intervention } from './interventions.js'
import type { ProjectSummary } from './projects.js'

const item = (n: number, url: string, project = 'p'): Intervention => ({
  projectId: project,
  projectName: project,
  kind: 'pr',
  number: n,
  title: `pr ${n}`,
  url,
})

test('InterventionTracker seeds a baseline on the first poll, then returns only new items', () => {
  const tracker = new InterventionTracker()
  // First poll = the queue that already existed at start-up: baseline, nothing announced.
  assert.deepEqual(tracker.observe([item(1, 'u1')]), [])
  // A new PR appears next poll -> just that one.
  assert.deepEqual(tracker.observe([item(1, 'u1'), item(2, 'u2')]).map(i => i.number), [2])
  // Nothing new -> empty.
  assert.deepEqual(tracker.observe([item(1, 'u1'), item(2, 'u2')]), [])
})

test('postDiscord posts one item with its number, title, project and url', async () => {
  let body: unknown
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postDiscord('https://discord/hook', [item(285, 'https://gh/pr/285', 'gemstack')], fetchImpl)
  const content = (body as { content: string }).content
  assert.match(content, /#285/)
  assert.match(content, /gemstack/)
  assert.match(content, /https:\/\/gh\/pr\/285/)
})

test('postDiscord summarizes multiple items and skips the call when there are none', async () => {
  const calls: string[] = []
  const fetchImpl = (async (_url, init) => {
    calls.push(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postDiscord('https://discord/hook', [item(1, 'u1'), item(2, 'u2')], fetchImpl)
  assert.match(JSON.parse(calls[0]!).content, /2 items need you/)
  await postDiscord('https://discord/hook', [], fetchImpl)
  assert.equal(calls.length, 1) // empty -> no second POST
})

test('startInterventionWatcher announces only items that appear after the first poll', async () => {
  const projects = async (): Promise<ProjectSummary[]> => [{ id: 'a', path: '/a', name: 'a', activated: true }]
  let current: Intervention[] = [item(1, 'u1')]
  const announced: number[][] = []
  const watcher = startInterventionWatcher({
    projects,
    build: async () => current,
    onNew: items => void announced.push(items.map(i => i.number)),
    intervalMs: 1_000_000, // effectively disable the timer; drive via poll()
  })
  try {
    // The constructor fires an immediate baseline poll (u1 already open) — let it settle.
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(announced, []) // baseline announces nothing
    current = [item(1, 'u1'), item(2, 'u2')]
    await watcher.poll() // u2 is new -> announced
    assert.deepEqual(announced, [[2]])
  } finally {
    watcher.stop()
  }
})
