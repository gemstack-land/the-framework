import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { ModelRegistry, type OrmAdapter, type QueryBuilder, type WhereClause, type OrderClause } from '@rudderjs/orm'

import { OrmUserMemory, UserMemoryRecord } from './memory-orm/index.js'
import {
  EmbeddingUserMemory,
  serializeVector,
  deserializeVector,
  cosineSimilarity,
} from './memory-embedding/index.js'
import { AiFake } from './fake.js'

// ─── Adapter mock (extended from Phase 4) ────────────────
//
// Same Map-backed adapter shape as packages/ai/src/memory-orm.test.ts,
// extended to track `update()` calls so we can verify the embedding
// column gets populated on remember().

interface StoredRow {
  [k: string]: unknown
  id:        string
  userId:    string
  fact:      string
  tags:      string | null
  score:     number | null
  embedding: Uint8Array | null
  createdAt: Date
  updatedAt: Date | null
}

function makeAdapter(rows: StoredRow[]): OrmAdapter {
  let nextId = 1

  function build(state: { wheres: WhereClause[]; order: OrderClause[]; limit?: number }): QueryBuilder<StoredRow> {
    const qb: QueryBuilder<StoredRow> = {
      where(col: string, opOrVal: unknown, value?: unknown) {
        const operator = arguments.length === 3 ? opOrVal as string : '='
        const val      = arguments.length === 3 ? value : opOrVal
        state.wheres.push({ column: col, operator: operator as WhereClause['operator'], value: val })
        return qb
      },
      orWhere() { return qb },
      selectRaw() { return qb },
      whereRaw() { return qb },
      orWhereRaw() { return qb },
      orderByRaw() { return qb },
      orderBy(col: string, dir: OrderClause['direction'] = 'ASC') {
        state.order.push({ column: col, direction: dir })
        return qb
      },
      limit(n: number) { state.limit = n; return qb },
      offset() { return qb },
      with()      { return qb },
      withPivot() { return qb },
      whereGroup() { return qb },
      orWhereGroup() { return qb },
      first: async () => qb.get().then(rows => rows[0] ?? null),
      find:  async (id) => rows.find(r => r.id === id) ?? null,
      get:   async () => {
        const result = rows.filter(r => state.wheres.every(w => matches(r, w)))
        if (state.limit !== undefined) return result.slice(0, state.limit)
        return result
      },
      all: async () => qb.get(),
      count: async () => (await qb.get()).length,
      create: async (data) => {
        const now = new Date()
        const row: StoredRow = {
          id:        `id-${nextId++}`,
          userId:    String((data as Record<string, unknown>)['userId']),
          fact:      String((data as Record<string, unknown>)['fact']),
          tags:      ((data as Record<string, unknown>)['tags'] as string | null) ?? null,
          score:     ((data as Record<string, unknown>)['score'] as number | null) ?? null,
          embedding: ((data as Record<string, unknown>)['embedding'] as Uint8Array | null) ?? null,
          createdAt: now,
          updatedAt: null,
        }
        rows.push(row)
        return row as unknown as StoredRow
      },
      update: async (id, data) => {
        const row = rows.find(r => r.id === id)
        if (row) {
          for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
            row[k] = v
          }
          row.updatedAt = new Date()
        }
        return (row ?? data) as unknown as StoredRow
      },
      delete: async (id) => {
        const idx = rows.findIndex(r => r.id === id)
        if (idx >= 0) rows.splice(idx, 1)
      },
      withTrashed: function() { return qb },
      onlyTrashed: function() { return qb },
      restore: async (_id) => ({} as StoredRow),
      forceDelete: async () => undefined,
      increment: async (_id, _col, _amount, _extra) => ({} as StoredRow),
      decrement: async (_id, _col, _amount, _extra) => ({} as StoredRow),
      insertMany: async () => undefined,
      deleteAll: async () => {
        const matchingIds = (await qb.get()).map(r => r.id)
        for (const id of matchingIds) {
          const idx = rows.findIndex(r => r.id === id)
          if (idx >= 0) rows.splice(idx, 1)
        }
        return matchingIds.length
      },
      updateAll: async () => 0,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
      whereRelationExists: () => qb,
      withAggregate: () => qb,
      _aggregate: async () => 0,
    }
    return qb
  }

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (() => build({ wheres: [], order: [] })) as () => QueryBuilder<any>,
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
}

function matches(row: StoredRow, w: WhereClause): boolean {
  const v = row[w.column]
  switch (w.operator) {
    case '=':    return v === w.value
    case '!=':   return v !== w.value
    default:     return true   // recall path doesn't reach here in Phase 5 (always whereGroup-less)
  }
}

// ─── Vector helpers ───────────────────────────────────────

describe('serializeVector / deserializeVector', () => {
  it('round-trips a simple vector', () => {
    const v = [0.1, 0.5, -0.3, 1.0, 0.0]
    const bytes  = serializeVector(v)
    const parsed = deserializeVector(bytes)
    assert.equal(bytes.byteLength, v.length * 4, '4 bytes per dim')
    assert.equal(parsed.length, v.length)
    for (let i = 0; i < v.length; i++) {
      // Float32 has limited precision — compare with a small epsilon.
      assert.ok(Math.abs(parsed[i]! - v[i]!) < 1e-6, `dim ${i}: ${parsed[i]} ~ ${v[i]}`)
    }
  })

  it('handles a 1536-dim OpenAI-shaped vector', () => {
    const v = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 0.1 : -0.1))
    const bytes  = serializeVector(v)
    assert.equal(bytes.byteLength, 1536 * 4)
    const parsed = deserializeVector(bytes)
    assert.equal(parsed.length, 1536)
  })

  it('handles a sliced Uint8Array (byteOffset > 0)', () => {
    const v = [0.1, 0.2, 0.3]
    const bytes = serializeVector(v)
    const padded = new Uint8Array(bytes.byteLength + 8)
    padded.set(bytes, 8)                                         // pad 8 leading bytes
    const sliced = padded.subarray(8)
    assert.equal(sliced.byteOffset, 8, 'sliced view carries offset')
    const parsed = deserializeVector(sliced)
    assert.equal(parsed.length, 3)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(parsed[i]! - v[i]!) < 1e-6)
    }
  })
})

describe('cosineSimilarity', () => {
  it('1.0 for identical vectors', () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1)
  })

  it('0 for orthogonal vectors', () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  })

  it('-1 for opposite vectors', () => {
    assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1)
  })

  it('handles zero-magnitude defensively (returns 0)', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0)
    assert.equal(cosineSimilarity([1, 1], [0, 0]), 0)
  })

  it('returns 0 for length mismatch (defensive)', () => {
    assert.equal(cosineSimilarity([1, 0, 0], [1, 0]), 0)
  })
})

// ─── EmbeddingUserMemory ───────────────────────────────────

describe('EmbeddingUserMemory', () => {
  let storedRows: StoredRow[]
  let mem:        EmbeddingUserMemory
  let inner:      OrmUserMemory
  let fake:       AiFake

  beforeEach(() => {
    storedRows = []
    ModelRegistry.reset()
    ModelRegistry.set(makeAdapter(storedRows))
    ModelRegistry.register(UserMemoryRecord)

    fake  = AiFake.fake()
    inner = new OrmUserMemory()
    mem   = new EmbeddingUserMemory({
      inner,
      model: '__fake__/embed-small',
    })
  })

  it('remember persists the row AND the embedding column', async () => {
    fake.respondWithEmbedding([[0.1, 0.2, 0.3]])

    const e = await mem.remember('u-1', 'Project name is Foo')
    assert.equal(e.fact, 'Project name is Foo')
    assert.equal(storedRows.length, 1)
    const stored = storedRows[0]!
    assert.ok(stored.embedding instanceof Uint8Array, 'embedding column populated')
    assert.deepStrictEqual(deserializeVector(stored.embedding!).map(n => Number(n.toFixed(2))), [0.1, 0.2, 0.3])
  })

  it('remember swallows embed failures — entry persists with null embedding', async () => {
    // `respondWithEmbedding([])` makes the fake return zero vectors.
    // Our `embed()` helper throws on `embeddings[0] === undefined`,
    // which `remember()` catches → the row is stored, embedding stays null.
    fake.respondWithEmbedding([])

    const e = await mem.remember('u-1', 'still saved')
    assert.equal(e.fact, 'still saved')
    assert.equal(storedRows.length, 1)
    assert.equal(storedRows[0]!.embedding, null, 'embedding stays null on failure')
  })

  it('recall ranks by cosine — semantically closest first', async () => {
    // Use a threshold of -1 so even opposite vectors aren't filtered out
    // and we can verify ordering across the full range.
    const ranker = new EmbeddingUserMemory({
      inner, model: '__fake__/embed-small', threshold: -1,
    })

    // A: aligned with the query vector (cos=1)
    fake.respondWithEmbedding([[1, 0, 0]])
    await ranker.remember('u-1', 'fact A')
    // B: orthogonal (cos=0)
    fake.respondWithEmbedding([[0, 1, 0]])
    await ranker.remember('u-1', 'fact B')
    // C: opposite (cos=-1)
    fake.respondWithEmbedding([[-1, 0, 0]])
    await ranker.remember('u-1', 'fact C')

    // Query vector matches A
    fake.respondWithEmbedding([[1, 0, 0]])
    const r = await ranker.recall('u-1', 'whatever')
    assert.deepStrictEqual(r.map(e => e.fact), ['fact A', 'fact B', 'fact C'])
    assert.ok(r[0]!.score! > 0.99)
    assert.ok(Math.abs(r[1]!.score!) < 0.01)
    assert.ok(r[2]!.score! < -0.99)
  })

  it('recall honors threshold — drops matches below the floor', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'aligned')
    fake.respondWithEmbedding([[0, 1, 0]])
    await mem.remember('u-1', 'orthogonal')

    // Bump threshold above 0 so the orthogonal match drops.
    const tighter = new EmbeddingUserMemory({
      inner, model: '__fake__/embed-small', threshold: 0.5,
    })

    fake.respondWithEmbedding([[1, 0, 0]])
    const r = await tighter.recall('u-1', 'q')
    assert.deepStrictEqual(r.map(e => e.fact), ['aligned'])
  })

  it('recall applies tag filter (JS-side)', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'with-tag', { tags: ['k'] })
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'no-tag')

    fake.respondWithEmbedding([[1, 0, 0]])
    const r = await mem.recall('u-1', 'q', { tags: ['k'] })
    assert.deepStrictEqual(r.map(e => e.fact), ['with-tag'])
  })

  it('recall applies limit after sorting', async () => {
    for (const v of [[1, 0, 0], [0.5, 0, 0], [0.1, 0, 0]]) {
      fake.respondWithEmbedding([v])
      await mem.remember('u-1', `score-${v[0]}`)
    }
    fake.respondWithEmbedding([[1, 0, 0]])
    const r = await mem.recall('u-1', 'q', { limit: 2 })
    assert.equal(r.length, 2)
    assert.equal(r[0]!.fact, 'score-1')
    assert.equal(r[1]!.fact, 'score-0.5')
  })

  it('recall falls back to token-overlap when query embed fails', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'alpha matches')
    fake.respondWithEmbedding([[0, 1, 0]])
    await mem.remember('u-1', 'unrelated stuff')

    // Make the next embed call (the recall query) "fail" — fake
    // returns no vectors, our `embed()` helper throws, recall
    // catches and falls through to token-overlap on row.fact.
    fake.respondWithEmbedding([])

    const r = await mem.recall('u-1', 'alpha')
    assert.deepStrictEqual(r.map(e => e.fact), ['alpha matches'], 'fallback to token-overlap')
  })

  it('recall token-overlap fallback for null-embedding rows (Phase 4 backward-compat)', async () => {
    // Simulate a row stored before Phase 5 was wired in: embedding stays null.
    storedRows.push({
      id:        'pre-existing',
      userId:    'u-1',
      fact:      'project name is foo',
      tags:      null,
      score:     null,
      embedding: null,
      createdAt: new Date(),
      updatedAt: null,
    })

    fake.respondWithEmbedding([[1, 0, 0]])     // query vector
    const r = await mem.recall('u-1', 'project')
    assert.deepStrictEqual(r.map(e => e.fact), ['project name is foo'])
  })

  it('null-embedding rows are dropped when nullEmbeddingFallback is "skip"', async () => {
    storedRows.push({
      id:        'pre-existing',
      userId:    'u-1',
      fact:      'project name is foo',
      tags:      null,
      score:     null,
      embedding: null,
      createdAt: new Date(),
      updatedAt: null,
    })

    const strict = new EmbeddingUserMemory({
      inner, model: '__fake__/embed-small', nullEmbeddingFallback: 'skip',
    })

    fake.respondWithEmbedding([[1, 0, 0]])
    const r = await strict.recall('u-1', 'project')
    assert.deepStrictEqual(r, [])
  })

  it('forget delegates to inner — row + embedding both gone', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    const e = await mem.remember('u-1', 'fact A')
    assert.equal(storedRows.length, 1)

    await mem.forget('u-1', e.id)
    assert.equal(storedRows.length, 0, 'row deleted; embedding gone with it (GDPR cascade)')
  })

  it('forgetAll delegates to inner', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'a')
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'b')
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-2', 'c')

    await mem.forgetAll!('u-1')
    assert.deepStrictEqual(storedRows.map(r => r.userId), ['u-2'])
  })

  it('list delegates to inner unchanged', async () => {
    fake.respondWithEmbedding([[1, 0, 0]])
    await mem.remember('u-1', 'first')
    fake.respondWithEmbedding([[0, 1, 0]])
    await mem.remember('u-1', 'second')

    const all = await mem.list('u-1')
    assert.deepStrictEqual(all.map(e => e.fact), ['first', 'second'])
  })
})
