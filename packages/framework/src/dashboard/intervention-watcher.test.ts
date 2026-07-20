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

test('postDiscord phrases a paused-run item as awaiting, with no PR number (#636)', async () => {
  const awaiting: Intervention = {
    projectId: 'p',
    projectName: 'gemstack',
    kind: 'awaiting',
    title: 'Cache the auth store?',
    url: 'http://localhost:4200',
    awaitId: 'g1',
  }
  let body: unknown
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postDiscord('https://discord/hook', [awaiting], fetchImpl)
  const content = (body as { content: string }).content
  assert.match(content, /Cache the auth store\?/)
  assert.match(content, /awaiting your answer/)
  assert.match(content, /http:\/\/localhost:4200/)
  assert.doesNotMatch(content, /#undefined/) // no phantom PR number
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
    onNew: items => void announced.push(items.map(i => i.number!)),
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

test('postDiscord names the branch for unpushed work, not a PR number (#860)', async () => {
  let body: unknown
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch

  await postDiscord(
    'https://discord/hook',
    [
      {
        projectId: 'p',
        projectName: 'gemstack',
        kind: 'unpushed',
        title: 'add the cart',
        url: 'http://localhost:4300',
        runId: 'r1',
        branch: 'the-framework/add-cart',
        commits: 2,
      },
    ],
    fetchImpl,
  )

  const content = String((body as { content: string }).content)
  assert.match(content, /add the cart/)
  assert.match(content, /2 commits/)
  assert.match(content, /the-framework\/add-cart/)
  assert.match(content, /never pushed/)
  assert.doesNotMatch(content, /#undefined/, 'must not fall through to the PR shape')
})

test('postDiscord says "1 commit" rather than "1 commits" (#860)', async () => {
  let body: unknown
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch

  await postDiscord(
    'https://discord/hook',
    [{ projectId: 'p', projectName: 'g', kind: 'unpushed', title: 't', url: '', runId: 'r', branch: 'b', commits: 1 }],
    fetchImpl,
  )
  assert.match(String((body as { content: string }).content), /1 commit(?!s)/)
})
