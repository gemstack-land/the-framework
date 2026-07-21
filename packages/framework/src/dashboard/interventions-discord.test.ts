import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { postInterventionsDiscord } from './interventions.js'
import type { Intervention } from './interventions.js'

const item = (n: number, url: string, project = 'p'): Intervention => ({
  projectId: project,
  projectName: project,
  kind: 'pr',
  number: n,
  title: `pr ${n}`,
  url,
})

test('postInterventionsDiscord posts one item with its number, title, project and url', async () => {
  let body: unknown
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postInterventionsDiscord('https://discord/hook', [item(285, 'https://gh/pr/285', 'gemstack')], fetchImpl)
  const content = (body as { content: string }).content
  assert.match(content, /#285/)
  assert.match(content, /gemstack/)
  assert.match(content, /https:\/\/gh\/pr\/285/)
})

test('postInterventionsDiscord phrases a paused-run item as awaiting, with no PR number (#636)', async () => {
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
  await postInterventionsDiscord('https://discord/hook', [awaiting], fetchImpl)
  const content = (body as { content: string }).content
  assert.match(content, /Cache the auth store\?/)
  assert.match(content, /awaiting your answer/)
  assert.match(content, /http:\/\/localhost:4200/)
  assert.doesNotMatch(content, /#undefined/) // no phantom PR number
})

test('postInterventionsDiscord summarizes multiple items and skips the call when there are none', async () => {
  const calls: string[] = []
  const fetchImpl = (async (_url, init) => {
    calls.push(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  await postInterventionsDiscord('https://discord/hook', [item(1, 'u1'), item(2, 'u2')], fetchImpl)
  assert.match(JSON.parse(calls[0]!).content, /2 items need you/)
  await postInterventionsDiscord('https://discord/hook', [], fetchImpl)
  assert.equal(calls.length, 1) // empty -> no second POST
})

test('postInterventionsDiscord names the branch for unpushed work, not a PR number (#860)', async () => {
  let body: unknown
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch

  await postInterventionsDiscord(
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

test('postInterventionsDiscord says "1 commit" rather than "1 commits" (#860)', async () => {
  let body: unknown
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch

  await postInterventionsDiscord(
    'https://discord/hook',
    [{ projectId: 'p', projectName: 'g', kind: 'unpushed', title: 't', url: '', runId: 'r', branch: 'b', commits: 1 }],
    fetchImpl,
  )
  assert.match(String((body as { content: string }).content), /1 commit(?!s)/)
})
