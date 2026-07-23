import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { postDiscordWebhook } from './discord-webhook.js'
import { MAX_CONTENT } from '../discord/rest.js'
import { postInterventionsDiscord, type Intervention } from './interventions.js'

test('content over the Discord limit is clamped, with the cut marked (#940)', async () => {
  let body: { content: string } | undefined
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const delivered = await postDiscordWebhook('https://discord/hook', 'x'.repeat(5000), fetchImpl)
  assert.equal(delivered, true)
  assert.ok(body!.content.length <= MAX_CONTENT, `sent ${body!.content.length} chars`)
  assert.match(body!.content, /truncated/)
})

test('a non-ok response resolves false instead of passing as delivered (#940)', async () => {
  const fetchImpl = (async () => new Response('{"message":"Request entity too large"}', { status: 400 })) as typeof fetch
  assert.equal(await postDiscordWebhook('https://discord/hook', 'hi', fetchImpl), false)
})

test('a network error resolves false rather than throwing out of a watcher (#940)', async () => {
  const fetchImpl = (async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }) as unknown as typeof fetch
  assert.equal(await postDiscordWebhook('https://discord/hook', 'hi', fetchImpl), false)
})

test('a long needs-you batch goes through clamped instead of silently posting nothing (#940)', async () => {
  // The shape that hit the limit in practice: many interventions with titles and urls in one batch.
  const items: Intervention[] = Array.from({ length: 40 }, (_, i) => ({
    projectId: 'p',
    projectName: 'p',
    kind: 'pr' as const,
    number: i,
    title: `a fairly long pull request title that repeats ${'x'.repeat(40)}`,
    url: `https://github.com/acme/repo/pull/${i}`,
  }))
  let body: { content: string } | undefined
  const fetchImpl = (async (_url, init) => {
    body = JSON.parse(String(init!.body))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  const delivered = await postInterventionsDiscord('https://discord/hook', items, fetchImpl)
  assert.equal(delivered, true)
  assert.ok(body!.content.length <= MAX_CONTENT, `sent ${body!.content.length} chars`)
})
