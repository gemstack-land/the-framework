import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  InMemoryAgentRunStore,
  CachedAgentRunStore,
  newAgentRunId,
  type AgentRunState,
} from './agent-run-store.js'
import type { CacheAdapter } from './cache-adapter.js'

function clientToolState(over: Partial<AgentRunState> = {}): AgentRunState {
  return {
    messages: [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'what is the weather?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'getWeather', arguments: { city: 'NYC' } }] },
    ],
    pendingToolCallIds: ['call_1'],
    stepsSoFar:  1,
    tokensSoFar: 42,
    ...over,
  }
}

function approvalState(): AgentRunState {
  return {
    messages: [
      { role: 'user', content: 'delete user 42' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_del', name: 'deleteUser', arguments: { id: 42 } }] },
    ],
    pendingToolCallIds: ['call_del'],
    stepsSoFar:  1,
    tokensSoFar: 30,
    pauseKind:   'approval',
    pendingApprovalToolCall: {
      toolCall:     { id: 'call_del', name: 'deleteUser', arguments: { id: 42 } },
      isClientTool: false,
    },
  }
}

// ─── newAgentRunId ─────────────────────────────────────────

describe('newAgentRunId', () => {
  it('returns a non-empty, unguessable string', () => {
    const id = newAgentRunId()
    assert.equal(typeof id, 'string')
    assert.ok(id.length >= 16)
  })

  it('does not collide across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newAgentRunId()))
    assert.equal(ids.size, 1000)
  })
})

// ─── InMemoryAgentRunStore ─────────────────────────────────

describe('InMemoryAgentRunStore', () => {
  it('stores then loads a snapshot non-destructively', async () => {
    const store = new InMemoryAgentRunStore()
    const id = newAgentRunId()
    const state = clientToolState()

    await store.store(id, state)

    const first  = await store.load(id)
    const second = await store.load(id)
    assert.deepStrictEqual(first, state)
    assert.deepStrictEqual(second, state) // load leaves it in place
  })

  it('consume returns the snapshot once, then null (single-use)', async () => {
    const store = new InMemoryAgentRunStore()
    const id = newAgentRunId()
    await store.store(id, clientToolState())

    const first  = await store.consume(id)
    const second = await store.consume(id)
    assert.ok(first)
    assert.equal(second, null)
  })

  it('load after consume returns null', async () => {
    const store = new InMemoryAgentRunStore()
    const id = newAgentRunId()
    await store.store(id, clientToolState())

    await store.consume(id)
    assert.equal(await store.load(id), null)
  })

  it('returns null for an unknown id', async () => {
    const store = new InMemoryAgentRunStore()
    assert.equal(await store.load('nope'), null)
    assert.equal(await store.consume('nope'), null)
  })

  it('round-trips an approval pause with its pending tool-call payload', async () => {
    const store = new InMemoryAgentRunStore()
    const id = newAgentRunId()
    const state = approvalState()
    await store.store(id, state)

    const loaded = await store.consume(id)
    assert.equal(loaded?.pauseKind, 'approval')
    assert.deepStrictEqual(loaded?.pendingApprovalToolCall, state.pendingApprovalToolCall)
  })

  it('preserves opaque meta verbatim', async () => {
    const store = new InMemoryAgentRunStore()
    const id = newAgentRunId()
    const meta = { userId: 'u1', threadId: 't9', agentSlug: 'writer' }
    await store.store(id, clientToolState({ meta }))

    assert.deepStrictEqual((await store.consume(id))?.meta, meta)
  })

  it('clear() drops all snapshots without consuming', async () => {
    const store = new InMemoryAgentRunStore()
    await store.store('a', clientToolState())
    await store.store('b', clientToolState())
    store.clear()
    assert.equal(await store.load('a'), null)
    assert.equal(await store.load('b'), null)
  })
})

// ─── CachedAgentRunStore ───────────────────────────────────

/** Minimal in-process fake of the `CacheAdapter` surface, with TTL capture. */
function fakeCache() {
  const map = new Map<string, unknown>()
  const ttls: Record<string, number | undefined> = {}
  return {
    map,
    ttls,
    async get<T>(key: string): Promise<T | null> {
      return (map.has(key) ? map.get(key) : null) as T | null
    },
    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      map.set(key, value)
      ttls[key] = ttlSeconds
    },
    async forget(key: string): Promise<void> {
      map.delete(key)
    },
  }
}

describe('CachedAgentRunStore', () => {
  it('namespaces keys with the default prefix and applies the 5-minute TTL', async () => {
    const cache = fakeCache()
    const store = new CachedAgentRunStore({ cache })
    await store.store('xyz', clientToolState())

    assert.ok(cache.map.has('gemstack:ai:agent-run:xyz'))
    assert.equal(cache.ttls['gemstack:ai:agent-run:xyz'], 5 * 60)
  })

  it('honors a custom keyPrefix and ttlSeconds', async () => {
    const cache = fakeCache()
    const store = new CachedAgentRunStore({ cache, keyPrefix: 'app:run:', ttlSeconds: 90 })
    await store.store('1', clientToolState())

    assert.ok(cache.map.has('app:run:1'))
    assert.equal(cache.ttls['app:run:1'], 90)
  })

  it('load reads without deleting; consume deletes', async () => {
    const cache = fakeCache()
    const store = new CachedAgentRunStore({ cache })
    await store.store('k', clientToolState())

    assert.ok(await store.load('k'))
    assert.ok(cache.map.has('gemstack:ai:agent-run:k')) // still there

    assert.ok(await store.consume('k'))
    assert.equal(cache.map.has('gemstack:ai:agent-run:k'), false) // gone
    assert.equal(await store.consume('k'), null)
  })

  it('returns null for a missing key', async () => {
    const store = new CachedAgentRunStore({ cache: fakeCache() })
    assert.equal(await store.load('missing'), null)
    assert.equal(await store.consume('missing'), null)
  })

  it('normalises an undefined cache miss to null', async () => {
    // some CacheAdapter impls resolve `undefined` rather than `null` on a miss
    const cache = {
      async get() { return undefined },
      async set() {},
      async forget() {},
    } as unknown as CacheAdapter
    const store = new CachedAgentRunStore({ cache })
    assert.equal(await store.load('missing'), null)
  })

  it('throws when constructed without a cache adapter', () => {
    assert.throws(() => new CachedAgentRunStore({} as never), /requires a cache adapter/)
  })
})
