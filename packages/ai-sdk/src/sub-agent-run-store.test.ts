import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  InMemorySubAgentRunStore,
  CachedSubAgentRunStore,
  type SubAgentRunSnapshot,
} from './sub-agent-run-store.js'

function clientToolSnapshot(over: Partial<SubAgentRunSnapshot> = {}): SubAgentRunSnapshot {
  return {
    messages: [
      { role: 'user', content: 'do work' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { q: 'x' } }] },
    ],
    pendingToolCallIds: ['call_1'],
    stepsSoFar:  1,
    tokensSoFar: 10,
    ...over,
  }
}

// ─── InMemorySubAgentRunStore ──────────────────────────────

describe('InMemorySubAgentRunStore.load', () => {
  it('reads a snapshot without consuming it (repeatable)', async () => {
    const store = new InMemorySubAgentRunStore()
    const snap = clientToolSnapshot()
    await store.store('r1', snap)

    const first  = await store.load('r1')
    const second = await store.load('r1')
    assert.deepStrictEqual(first, snap)
    assert.deepStrictEqual(second, snap) // load leaves it in place
  })

  it('does not interfere with a later single-use consume', async () => {
    const store = new InMemorySubAgentRunStore()
    await store.store('r1', clientToolSnapshot())

    assert.ok(await store.load('r1'))            // peek
    assert.ok(await store.consume('r1'))         // resume owns the consume
    assert.equal(await store.consume('r1'), null) // gone after one consume
  })

  it('returns null after the snapshot has been consumed', async () => {
    const store = new InMemorySubAgentRunStore()
    await store.store('r1', clientToolSnapshot())
    await store.consume('r1')
    assert.equal(await store.load('r1'), null)
  })

  it('returns null for an unknown id', async () => {
    const store = new InMemorySubAgentRunStore()
    assert.equal(await store.load('nope'), null)
  })

  it('exposes meta for pre-flight validation without consuming', async () => {
    const store = new InMemorySubAgentRunStore()
    const meta = { userId: 'u1', resourceSlug: 'invoices', recordId: 42 }
    await store.store('r1', clientToolSnapshot({ meta }))

    // A host validates ownership off `meta`, then the snapshot is still
    // present for the resume path to consume.
    assert.deepStrictEqual((await store.load('r1'))?.meta, meta)
    assert.ok(await store.consume('r1'))
  })
})

// ─── CachedSubAgentRunStore ────────────────────────────────

/** Minimal in-process fake of `@rudderjs/cache`'s adapter surface. */
function fakeCache() {
  const map = new Map<string, unknown>()
  return {
    map,
    async get<T>(key: string): Promise<T | null> {
      return (map.has(key) ? map.get(key) : null) as T | null
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value)
    },
    async forget(key: string): Promise<void> {
      map.delete(key)
    },
  }
}

describe('CachedSubAgentRunStore.load', () => {
  it('reads without deleting; consume deletes', async () => {
    const cache = fakeCache()
    const store = new CachedSubAgentRunStore({ cache })
    await store.store('k', clientToolSnapshot())

    assert.ok(await store.load('k'))
    assert.ok(cache.map.has('gemstack:ai:sub-agent-run:k')) // still there after load

    assert.ok(await store.consume('k'))
    assert.equal(cache.map.has('gemstack:ai:sub-agent-run:k'), false) // gone after consume
  })

  it('returns null for an unknown id', async () => {
    const cache = fakeCache()
    const store = new CachedSubAgentRunStore({ cache })
    assert.equal(await store.load('missing'), null)
  })

  it('honors a custom keyPrefix', async () => {
    const cache = fakeCache()
    const store = new CachedSubAgentRunStore({ cache, keyPrefix: 'app:sub:' })
    await store.store('1', clientToolSnapshot())
    assert.ok(await store.load('1'))
    assert.ok(cache.map.has('app:sub:1'))
  })

  it('throws when constructed without a cache adapter', () => {
    assert.throws(() => new CachedSubAgentRunStore({} as never), /requires a cache adapter/)
  })
})
