import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  GoogleCacheRegistry,
  buildGoogleCacheKey,
  splitContentsAtCache,
  durationToGoogleTtl,
  type CacheStoreLike,
  type GoogleClientLike,
} from './providers/google-cache-registry.js'
import { GoogleAdapter } from './providers/google.js'

// ─── Test doubles ─────────────────────────────────────────

interface FakeCounters {
  createCalls: number
  createPayloads: Array<{ model: string; config: Record<string, unknown> }>
  generateCalls: number
  generatePayloads: Array<Record<string, unknown>>
}

interface FakeClient extends GoogleClientLike {
  models: {
    generateContent: (p: Record<string, unknown>) => Promise<unknown>
    generateContentStream: (p: Record<string, unknown>) => Promise<AsyncIterable<unknown>>
  }
}

function createFakeClient(opts: {
  createImpl?: (
    args: { model: string; config: Record<string, unknown> },
    counters: FakeCounters,
  ) => Promise<{ name: string; expireTime?: string }> | { name: string; expireTime?: string }
  generateImpl?: (
    payload: Record<string, unknown>,
    counters: FakeCounters,
  ) => Promise<unknown> | unknown
} = {}): { client: FakeClient; counters: FakeCounters } {
  const counters: FakeCounters = {
    createCalls: 0,
    createPayloads: [],
    generateCalls: 0,
    generatePayloads: [],
  }
  let next = 1
  const client: FakeClient = {
    caches: {
      async create(args: { model: string; config: Record<string, unknown> }) {
        counters.createCalls++
        counters.createPayloads.push(args)
        if (opts.createImpl) return opts.createImpl(args, counters)
        return { name: `cachedContents/auto-${next++}` }
      },
      async delete(_args: { name: string }) { /* no-op */ },
    },
    models: {
      async generateContent(payload: Record<string, unknown>) {
        counters.generateCalls++
        counters.generatePayloads.push(payload)
        if (opts.generateImpl) return opts.generateImpl(payload, counters)
        return {
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }
      },
      async generateContentStream(_payload: Record<string, unknown>) {
        return (async function* () { /* unused in these tests */ })()
      },
    },
  }
  return { client, counters }
}

function createMemoryStore(): CacheStoreLike & { _data: Map<string, { value: unknown; expiresAtMs: number }>; nowMs: number } {
  const store = {
    _data: new Map<string, { value: unknown; expiresAtMs: number }>(),
    nowMs: 0,
    async get<T = unknown>(key: string): Promise<T | null> {
      const entry = this._data.get(key)
      if (!entry) return null
      if (entry.expiresAtMs <= this.nowMs) {
        this._data.delete(key)
        return null
      }
      return entry.value as T
    },
    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      const ttlMs = (ttlSeconds ?? 60) * 1000
      this._data.set(key, { value, expiresAtMs: this.nowMs + ttlMs })
    },
    async forget(key: string): Promise<void> {
      this._data.delete(key)
    },
  }
  return store
}

// ─── Helper unit tests ────────────────────────────────────

describe('buildGoogleCacheKey', () => {
  it('returns undefined when no markers are set', () => {
    assert.equal(buildGoogleCacheKey('m', undefined, 's', [], undefined), undefined)
    assert.equal(buildGoogleCacheKey('m', {}, 's', [], undefined), undefined)
  })

  it('changes when the model changes (caches are model-bound)', () => {
    const a = buildGoogleCacheKey('gemini-2.5-flash', { instructions: true }, 'sys', [], undefined)
    const b = buildGoogleCacheKey('gemini-2.5-pro',   { instructions: true }, 'sys', [], undefined)
    assert.ok(a)
    assert.ok(b)
    assert.notEqual(a, b)
  })

  it('is stable for identical inputs', () => {
    const a = buildGoogleCacheKey('m', { instructions: true, tools: true }, 'sys', [], [{ name: 't' }])
    const b = buildGoogleCacheKey('m', { instructions: true, tools: true }, 'sys', [], [{ name: 't' }])
    assert.equal(a, b)
  })

  it('only hashes the first N messages when messages: N is set', () => {
    const base    = buildGoogleCacheKey('m', { messages: 1 }, undefined, [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'user', parts: [{ text: 'b' }] }], undefined)
    const changed = buildGoogleCacheKey('m', { messages: 1 }, undefined, [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'user', parts: [{ text: 'CHANGED' }] }], undefined)
    assert.equal(base, changed)
  })
})

describe('splitContentsAtCache', () => {
  it('splits at the messages count', () => {
    const r = splitContentsAtCache([1, 2, 3, 4], { messages: 2 })
    assert.deepStrictEqual(r.cached, [1, 2])
    assert.deepStrictEqual(r.fresh, [3, 4])
  })

  it('handles missing markers as zero', () => {
    const r = splitContentsAtCache([1, 2, 3], undefined)
    assert.deepStrictEqual(r.cached, [])
    assert.deepStrictEqual(r.fresh, [1, 2, 3])
  })

  it('clamps to array length', () => {
    const r = splitContentsAtCache([1], { messages: 99 })
    assert.deepStrictEqual(r.cached, [1])
    assert.deepStrictEqual(r.fresh, [])
  })
})

describe('durationToGoogleTtl', () => {
  it('formats hours as seconds with s suffix', () => {
    assert.equal(durationToGoogleTtl('1h'), '3600s')
    assert.equal(durationToGoogleTtl('30m'), '1800s')
    assert.equal(durationToGoogleTtl('45s'), '45s')
  })
})

// ─── Registry behaviour ───────────────────────────────────

describe('GoogleCacheRegistry', () => {
  it('caches by key — second resolve with same key reuses the resource', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry()

    const a = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'k1' })
    const b = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'k1' })

    assert.equal(a, b)
    assert.equal(counters.createCalls, 1, 'caches.create should be called exactly once')
  })

  it('creates a fresh resource for a different cache key (e.g. different model)', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry()

    const a = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'flash' })
    const b = await reg.resolve({ client, model: 'gemini-2.5-pro',   cacheKey: 'pro' })

    assert.notEqual(a, b)
    assert.equal(counters.createCalls, 2)
  })

  it('memoizes "too small" errors and returns null without retrying for 5 minutes', async () => {
    const { client, counters } = createFakeClient({
      createImpl: () => { throw new Error('Cached content size below the minimum input token count for model.') },
    })
    let now = 1_000_000
    const reg = new GoogleCacheRegistry({ now: () => now })

    const a = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'tiny' })
    assert.equal(a, null)

    // Within 5min — no retry, still null.
    now += 60_000
    const b = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'tiny' })
    assert.equal(b, null)
    assert.equal(counters.createCalls, 1, 'no retry within memoization window')

    // After 5min — memoization expired, retries the create.
    now += 5 * 60_000 + 1
    const c = await reg.resolve({ client, model: 'gemini-2.5-flash', cacheKey: 'tiny' })
    assert.equal(c, null)
    assert.equal(counters.createCalls, 2, 'retries after memoization window expires')
  })

  it('forget() drops the entry so the next resolve recreates', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry()

    await reg.resolve({ client, model: 'm', cacheKey: 'k1' })
    await reg.forget('k1')
    await reg.resolve({ client, model: 'm', cacheKey: 'k1' })

    assert.equal(counters.createCalls, 2)
  })

  it('dedups concurrent same-key resolves into one create call', async () => {
    let resolveCreate: (v: { name: string }) => void = () => {}
    const createPromise = new Promise<{ name: string }>((res) => { resolveCreate = res })
    const { client, counters } = createFakeClient({
      createImpl: () => createPromise,
    })
    const reg = new GoogleCacheRegistry()

    // Fire two concurrent resolves with the same key.
    const p1 = reg.resolve({ client, model: 'm', cacheKey: 'shared' })
    const p2 = reg.resolve({ client, model: 'm', cacheKey: 'shared' })

    // Now release the create.
    resolveCreate({ name: 'cachedContents/shared-1' })

    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1, 'cachedContents/shared-1')
    assert.equal(r2, 'cachedContents/shared-1')
    assert.equal(counters.createCalls, 1, 'concurrent resolves share one create call')
  })

  it('returns null on non-too-small errors without poisoning the cache', async () => {
    let attempt = 0
    const { client, counters } = createFakeClient({
      createImpl: () => {
        attempt++
        if (attempt === 1) throw new Error('transient network blip')
        return { name: 'cachedContents/recovered' }
      },
    })
    const reg = new GoogleCacheRegistry()

    const a = await reg.resolve({ client, model: 'm', cacheKey: 'k' })
    assert.equal(a, null, 'first call returns null because create failed')

    // Second call retries — no memoization for non-too-small errors.
    const b = await reg.resolve({ client, model: 'm', cacheKey: 'k' })
    assert.equal(b, 'cachedContents/recovered')
    assert.equal(counters.createCalls, 2)
  })

  it('uses provided cache store across resolutions (cross-process simulation)', async () => {
    const store = createMemoryStore()
    store.nowMs = 1_000_000
    const { client, counters } = createFakeClient()

    // Two registry instances sharing the same store — simulates two workers.
    const regA = new GoogleCacheRegistry({ store, now: () => store.nowMs })
    const regB = new GoogleCacheRegistry({ store, now: () => store.nowMs })

    await regA.resolve({ client, model: 'm', cacheKey: 'shared-store' })
    await regB.resolve({ client, model: 'm', cacheKey: 'shared-store' })

    assert.equal(counters.createCalls, 1, 'second worker reads from the shared store')
  })

  it('forwards ttl to caches.create when provided', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry({ defaultTtl: '2h' })

    await reg.resolve({ client, model: 'm', cacheKey: 'k', ttl: '6h' })
    assert.equal(counters.createPayloads[0]!.config['ttl'], '6h')
  })
})

// ─── Adapter wiring ───────────────────────────────────────

describe('GoogleAdapter cache wiring', () => {
  it('sends cachedContent and omits the cached regions on the request', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry()
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash', reg)
    ;(adapter as unknown as { client: unknown }).client = client  // bypass the dynamic SDK import

    await adapter.generate({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user',   content: 'first' },
        { role: 'user',   content: 'fresh' },
      ],
      tools: [{ name: 't', description: 'T', parameters: {} }],
      cache: { instructions: true, tools: true, messages: 1 },
    })

    const payload = counters.generatePayloads[0]!
    assert.ok(payload, 'generateContent should be called')
    const cfg = payload['config'] as Record<string, unknown>
    assert.ok(cfg['cachedContent'], 'request should carry cachedContent')
    assert.equal(cfg['tools'], undefined, 'tools should be omitted when cached')
    assert.equal(payload['systemInstruction'], undefined, 'systemInstruction should be omitted when cached')
    assert.deepStrictEqual(
      (payload['contents'] as unknown[]).length, 1, 'only the fresh tail of the message list goes on the request',
    )
  })

  it('runs uncached when registry returns null (e.g. too small)', async () => {
    const { client, counters } = createFakeClient({
      createImpl: () => { throw new Error('Cached content size below the minimum input token count.') },
    })
    const reg = new GoogleCacheRegistry()
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash', reg)
    ;(adapter as unknown as { client: unknown }).client = client

    await adapter.generate({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user',   content: 'hi' },
      ],
      cache: { instructions: true },
    })

    const payload = counters.generatePayloads[0]!
    const cfg = payload['config'] as Record<string, unknown>
    assert.equal(cfg['cachedContent'], undefined, 'cachedContent must NOT be set when registry returned null')
    assert.ok(payload['systemInstruction'], 'systemInstruction is still sent on the uncached fallback')
  })

  it('recreates and retries once on a 404 stale-cache error', async () => {
    let staleServed = false
    const { client, counters } = createFakeClient({
      generateImpl: (payload) => {
        const cfg = payload['config'] as Record<string, unknown>
        if (cfg['cachedContent'] && !staleServed) {
          staleServed = true
          const err = new Error('cachedContent not found') as Error & { status?: number }
          err.status = 404
          throw err
        }
        return {
          candidates: [{ content: { parts: [{ text: 'recovered' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        }
      },
    })
    const reg = new GoogleCacheRegistry()
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash', reg)
    ;(adapter as unknown as { client: unknown }).client = client

    const response = await adapter.generate({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user',   content: 'hi' },
      ],
      cache: { instructions: true },
    })

    assert.equal(response.message.content, 'recovered')
    assert.equal(counters.createCalls, 2, 'forget + recreate path called caches.create twice')
    assert.equal(counters.generateCalls, 2, 'one failed call + one successful retry')
  })

  it('does not consult the registry when no cache markers are set', async () => {
    const { client, counters } = createFakeClient()
    const reg = new GoogleCacheRegistry()
    const adapter = new GoogleAdapter({ apiKey: 'k' }, 'gemini-2.5-flash', reg)
    ;(adapter as unknown as { client: unknown }).client = client

    await adapter.generate({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })

    assert.equal(counters.createCalls, 0)
  })
})
