import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { ModelRegistry, type OrmAdapter, type QueryBuilder, type WhereClause, type OrderClause } from '@rudderjs/orm'

import { OrmUserMemory, UserMemoryRecord, userMemoryPrismaSchema } from './memory-orm/index.js'
import type { MemoryEntry } from './types.js'

// ─── In-memory adapter ────────────────────────────────────
//
// Mirrors the shape used by `packages/orm/src/index.test.ts` but extends
// it with enough machinery to exercise the OR-of-LIKE recall path. The
// stub is the QueryBuilder; rows live in a Map keyed by id, scoped
// by class name (we only register UserMemoryRecord here).

interface StoredRow {
  [k: string]: unknown
  id:        string
  userId:    string
  fact:      string
  tags:      string | null
  score:     number | null
  createdAt: Date
  updatedAt: Date | null
}

function makeAdapter(rows: StoredRow[]): { adapter: OrmAdapter; rows: StoredRow[] } {
  let nextId = 1

  function build(state: { wheres: WhereClause[]; groupedWheres: WhereClause[][]; order: OrderClause[]; limit?: number }): QueryBuilder<StoredRow> {
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
      whereGroup(fn) {
        // Capture each `orWhere` inside the group as a WhereClause[].
        const captured: WhereClause[] = []
        const inner: QueryBuilder<StoredRow> = {
          ...qb,
          where(col: string, opOrVal: unknown, value?: unknown) {
            const operator = arguments.length === 3 ? opOrVal as string : '='
            const val      = arguments.length === 3 ? value : opOrVal
            captured.push({ column: col, operator: operator as WhereClause['operator'], value: val })
            return inner
          },
          orWhere(col: string, opOrVal: unknown, value?: unknown) {
            const operator = arguments.length === 3 ? opOrVal as string : '='
            const val      = arguments.length === 3 ? value : opOrVal
            captured.push({ column: col, operator: operator as WhereClause['operator'], value: val })
            return inner
          },
        }
        fn(inner)
        if (captured.length > 0) state.groupedWheres.push(captured)
        return qb
      },
      orWhereGroup() { return qb },
      first: async () => qb.get().then(rows => rows[0] ?? null),
      find:  async (id) => rows.find(r => r.id === id) ?? null,
      get:   async () => {
        let result = rows.filter(r => state.wheres.every(w => matches(r, w)))
        if (state.groupedWheres.length > 0) {
          // ALL groups must match (groups are AND'd); within each group any clause matches (OR).
          result = result.filter(r => state.groupedWheres.every(g => g.some(w => matches(r, w))))
        }
        for (const o of state.order) {
          result = [...result].sort((a, b) => {
            const av = a[o.column] as never; const bv = b[o.column] as never
            if (av < bv) return o.direction === 'ASC' ? -1 :  1
            if (av > bv) return o.direction === 'ASC' ?  1 : -1
            return 0
          })
        }
        if (state.limit !== undefined) result = result.slice(0, state.limit)
        return result as unknown as StoredRow[]
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
          createdAt: now,
          updatedAt: null,
        }
        rows.push(row)
        return row as unknown as StoredRow
      },
      update: async (_id, data) => data as StoredRow,
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
      deleteAll:  async () => {
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

  const adapter: OrmAdapter = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (() => build({ wheres: [], groupedWheres: [], order: [] })) as () => QueryBuilder<any>,
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
  return { adapter, rows }
}

function matches(row: StoredRow, w: WhereClause): boolean {
  const v = row[w.column]
  switch (w.operator) {
    case '=':        return v === w.value
    case '!=':       return v !== w.value
    case 'LIKE': {
      if (typeof v !== 'string' || typeof w.value !== 'string') return false
      // SQL `%foo%` → JS `.includes('foo')`. Strip leading/trailing % only.
      const pat = w.value.replace(/^%/, '').replace(/%$/, '')
      return v.toLowerCase().includes(pat.toLowerCase())
    }
    default: return true
  }
}

// ─── OrmUserMemory ────────────────────────────────────────

describe('OrmUserMemory', () => {
  let mem: OrmUserMemory
  let storedRows: StoredRow[]

  beforeEach(() => {
    storedRows = []
    const { adapter } = makeAdapter(storedRows)
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    ModelRegistry.register(UserMemoryRecord)
    mem = new OrmUserMemory()
  })

  it('remember persists to the registered adapter and returns a hydrated entry', async () => {
    const e = await mem.remember('u-1', 'Project name is Foo', { tags: ['project'], score: 0.9 })
    assert.equal(e.userId, 'u-1')
    assert.equal(e.fact,   'Project name is Foo')
    assert.deepStrictEqual(e.tags, ['project'])
    assert.equal(e.score, 0.9)
    assert.ok(e.createdAt instanceof Date)
    assert.equal(storedRows.length, 1, 'one row inserted')
    assert.equal(storedRows[0]!.tags, JSON.stringify(['project']), 'tags JSON-encoded on disk')
  })

  it('remember without tags or score omits them on the hydrated entry', async () => {
    const e = await mem.remember('u-1', 'bare fact')
    assert.equal('tags'  in e, false)
    assert.equal('score' in e, false)
    assert.equal(storedRows[0]!.tags, null)
    assert.equal(storedRows[0]!.score, null)
  })

  it('list returns only the user’s rows in insertion order', async () => {
    await mem.remember('u-1', 'first')
    await mem.remember('u-2', 'other')
    await mem.remember('u-1', 'second')
    const own = await mem.list('u-1')
    assert.deepStrictEqual(own.map(e => e.fact), ['first', 'second'])
  })

  it('list filters by tag intersection (JS-side)', async () => {
    await mem.remember('u-1', 'a', { tags: ['x', 'y'] })
    await mem.remember('u-1', 'b', { tags: ['x'] })
    await mem.remember('u-1', 'c', { tags: ['z'] })
    const xy = await mem.list('u-1', { tags: ['x', 'y'] })
    assert.deepStrictEqual(xy.map(e => e.fact), ['a'])
  })

  it('list applies limit', async () => {
    for (let i = 0; i < 4; i++) await mem.remember('u-1', `item ${i}`)
    const r = await mem.list('u-1', { limit: 2 })
    assert.equal(r.length, 2)
  })

  it('recall does case-insensitive token-OR-LIKE on the fact column', async () => {
    await mem.remember('u-1', 'Project name is Foo')
    await mem.remember('u-1', 'lives in Paris')
    await mem.remember('u-1', 'unrelated thing')

    const r = await mem.recall('u-1', 'what is my project?')
    assert.deepStrictEqual(r.map(e => e.fact), ['Project name is Foo'])
  })

  it('recall returns multiple matches when the query has multiple meaningful tokens', async () => {
    await mem.remember('u-1', 'Project name is Foo')
    await mem.remember('u-1', 'lives in Paris')
    await mem.remember('u-1', 'unrelated thing')

    const r = await mem.recall('u-1', 'project paris')
    assert.deepStrictEqual(r.map(e => e.fact).sort(), ['Project name is Foo', 'lives in Paris'])
  })

  it('recall scoped by tag filter intersects (JS-side)', async () => {
    await mem.remember('u-1', 'item alpha', { tags: ['t1'] })
    await mem.remember('u-1', 'item beta',  { tags: ['t2'] })
    const r = await mem.recall('u-1', 'item', { tags: ['t1'] })
    assert.deepStrictEqual(r.map(e => e.fact), ['item alpha'])
  })

  it('recall applies limit', async () => {
    for (let i = 0; i < 4; i++) await mem.remember('u-1', `item ${i}`)
    const r = await mem.recall('u-1', 'item', { limit: 2 })
    assert.equal(r.length, 2)
  })

  it('recall returns empty when nothing matches', async () => {
    await mem.remember('u-1', 'a')
    const r = await mem.recall('u-1', 'zzz')
    assert.deepStrictEqual(r, [])
  })

  it('recall with empty query (no meaningful tokens) returns all the user’s facts', async () => {
    await mem.remember('u-1', 'a')
    await mem.remember('u-1', 'b')
    const r = await mem.recall('u-1', '???')
    assert.equal(r.length, 2)
  })

  it('forget removes the row only when the user owns it', async () => {
    const own  = await mem.remember('u-1', 'mine')
    const them = await mem.remember('u-2', 'theirs')

    await mem.forget('u-1', them.id)
    assert.equal(storedRows.length, 2, 'wrong-owner forget is a no-op')

    await mem.forget('u-1', own.id)
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.equal(storedRows.length, 1, 'theirs row remains')
  })

  it('forget on unknown id is a silent no-op (idempotent)', async () => {
    await assert.doesNotReject(mem.forget('u-1', 'does-not-exist'))
  })

  it('forgetAll wipes a single user without touching others', async () => {
    await mem.remember('u-1', 'a')
    await mem.remember('u-1', 'b')
    await mem.remember('u-2', 'c')
    await mem.forgetAll!('u-1')
    assert.deepStrictEqual(await mem.list('u-1'), [])
    assert.equal((await mem.list('u-2')).length, 1)
  })
})

// ─── UserMemoryRecord helpers ─────────────────────────────

describe('UserMemoryRecord.getTags', () => {
  it('returns the parsed array', () => {
    const r = new UserMemoryRecord()
    r.tags = JSON.stringify(['a', 'b'])
    assert.deepStrictEqual(r.getTags(), ['a', 'b'])
  })

  it('returns [] for null', () => {
    const r = new UserMemoryRecord()
    r.tags = null
    assert.deepStrictEqual(r.getTags(), [])
  })

  it('returns [] for malformed JSON', () => {
    const r = new UserMemoryRecord()
    r.tags = 'not json'
    assert.deepStrictEqual(r.getTags(), [])
  })

  it('filters non-string entries', () => {
    const r = new UserMemoryRecord()
    r.tags = JSON.stringify(['ok', 1, null, 'fine'])
    assert.deepStrictEqual(r.getTags(), ['ok', 'fine'])
  })
})

describe('userMemoryPrismaSchema', () => {
  it('contains the model declaration with required columns', () => {
    assert.match(userMemoryPrismaSchema, /model UserMemory/)
    assert.match(userMemoryPrismaSchema, /id\s+String/)
    assert.match(userMemoryPrismaSchema, /userId\s+String/)
    assert.match(userMemoryPrismaSchema, /fact\s+String/)
    assert.match(userMemoryPrismaSchema, /tags\s+String\?/)
    assert.match(userMemoryPrismaSchema, /score\s+Float\?/)
    assert.match(userMemoryPrismaSchema, /embedding\s+Bytes\?/)
    assert.match(userMemoryPrismaSchema, /@@index\(\[userId\]\)/)
  })
})

// suppress "unused" — MemoryEntry is consumed implicitly through the
// returned shapes but the type alias keeps the test file self-documenting.
type _Unused = MemoryEntry
