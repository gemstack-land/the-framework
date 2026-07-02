import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dokployTarget, type FetchLike } from './dokploy.js'
import type { DeployPlan, DeployTargetContext } from './types.js'

interface FetchCall {
  url: string
  init?: RequestInit
}

/** A fake fetch that records calls and returns a canned response. */
function fakeFetch(response: { status?: number; body?: string } = {}): FetchLike & { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) })
    const status = response.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return response.body ?? ''
      },
    } as Response
  }) as FetchLike & { calls: FetchCall[] }
  fn.calls = calls
  return fn
}

const ctx: DeployTargetContext = {
  plan: { render: 'ssr', target: 'dokploy', reason: 'per-request data' } as DeployPlan,
  intent: 'an app',
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body))
}

test('triggers a deploy for the configured application and reports success', async () => {
  const fetch = fakeFetch()
  const target = dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'app_123', apiToken: 'tok', fetch })
  const res = await target.deploy(ctx)
  assert.equal(res.deployed, true)
  assert.match(res.detail ?? '', /app_123/)
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0]!.url, 'https://dok.example.com/api/application.deploy')
  const headers = fetch.calls[0]!.init?.headers as Record<string, string>
  assert.equal(headers['x-api-key'], 'tok')
  assert.equal(bodyOf(fetch.calls[0]!.init).applicationId, 'app_123')
})

test('normalizes a serverUrl that already ends in /api or a slash', async () => {
  const fetch = fakeFetch()
  await dokployTarget({ serverUrl: 'https://dok.example.com/api/', applicationId: 'a', apiToken: 't', fetch }).deploy(ctx)
  assert.equal(fetch.calls[0]!.url, 'https://dok.example.com/api/application.deploy')
})

test('redeploy hits the application.redeploy endpoint', async () => {
  const fetch = fakeFetch()
  await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'a', apiToken: 't', redeploy: true, fetch }).deploy(ctx)
  assert.match(fetch.calls[0]!.url, /application\.redeploy$/)
})

test('a missing token short-circuits before any request', async () => {
  const saved = { auth: process.env.DOKPLOY_AUTH_TOKEN, key: process.env.DOKPLOY_API_KEY }
  delete process.env.DOKPLOY_AUTH_TOKEN
  delete process.env.DOKPLOY_API_KEY
  try {
    const fetch = fakeFetch()
    const res = await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'a', fetch }).deploy(ctx)
    assert.equal(res.deployed, false)
    assert.match(res.detail ?? '', /DOKPLOY_AUTH_TOKEN/)
    assert.equal(fetch.calls.length, 0)
  } finally {
    if (saved.auth !== undefined) process.env.DOKPLOY_AUTH_TOKEN = saved.auth
    if (saved.key !== undefined) process.env.DOKPLOY_API_KEY = saved.key
  }
})

test('the token falls back to DOKPLOY_AUTH_TOKEN in the environment', async () => {
  const saved = process.env.DOKPLOY_AUTH_TOKEN
  process.env.DOKPLOY_AUTH_TOKEN = 'env-tok'
  try {
    const fetch = fakeFetch()
    await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'a', fetch }).deploy(ctx)
    const headers = fetch.calls[0]!.init?.headers as Record<string, string>
    assert.equal(headers['x-api-key'], 'env-tok')
  } finally {
    if (saved === undefined) delete process.env.DOKPLOY_AUTH_TOKEN
    else process.env.DOKPLOY_AUTH_TOKEN = saved
  }
})

test('a non-2xx response surfaces the status and body', async () => {
  const fetch = fakeFetch({ status: 401, body: 'invalid api key' })
  const res = await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'a', apiToken: 'bad', fetch }).deploy(ctx)
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /401/)
  assert.match(res.detail ?? '', /invalid api key/)
})

test('a network rejection is caught, not thrown', async () => {
  const fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as FetchLike
  const res = await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: 'a', apiToken: 't', fetch }).deploy(ctx)
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /request failed/)
})

test('a missing applicationId short-circuits', async () => {
  const fetch = fakeFetch()
  const res = await dokployTarget({ serverUrl: 'https://dok.example.com', applicationId: '', apiToken: 't', fetch }).deploy(ctx)
  assert.equal(res.deployed, false)
  assert.match(res.detail ?? '', /applicationId/)
  assert.equal(fetch.calls.length, 0)
})
