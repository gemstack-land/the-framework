import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { ModelRegistry, type OrmAdapter, type QueryBuilder, type WhereClause } from '@rudderjs/orm'

import {
  AiConversationRecord,
  AiConversationMessageRecord,
  OrmConversationStore,
  ormConversationStore,
  conversationOrmPrismaSchema,
} from './conversation-orm/index.js'
import type { AiMessage } from './types.js'

// ─── In-memory adapter (two tables, routed by name) ───────
//
// Supports just the operations OrmConversationStore uses - where (equality),
// orderBy (single column, number or Date), first, get, create, updateAll,
// deleteAll. Throws on anything else so a new dependency surfaces loudly.

type Row = Record<string, unknown> & { id: string }

interface State {
  table:  string
  wheres: WhereClause[]
  order:  { column: string; dir: 'ASC' | 'DESC' } | null
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number)
  const bv = b instanceof Date ? b.getTime() : (b as number)
  return av < bv ? -1 : av > bv ? 1 : 0
}

function makeAdapter(): { adapter: OrmAdapter; tables: Map<string, Row[]> } {
  const tables = new Map<string, Row[]>()
  const counters = new Map<string, number>()
  const rowsFor = (t: string): Row[] => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }

  function build(state: State): QueryBuilder<Row> {
    const matched = (): Row[] => {
      let out = rowsFor(state.table).filter(r => state.wheres.every(w => r[w.column] === w.value))
      if (state.order) {
        const { column, dir } = state.order
        out = [...out].sort((a, b) => (dir === 'ASC' ? 1 : -1) * compare(a[column], b[column]))
      }
      return out
    }

    const qb: Partial<QueryBuilder<Row>> = {
      where(col: string, opOrVal?: unknown, value?: unknown) {
        const val = arguments.length === 3 ? value : opOrVal
        state.wheres.push({ column: col, operator: '=', value: val } as WhereClause)
        return qb as QueryBuilder<Row>
      },
      orderBy(col: string, dir?: string) {
        state.order = { column: col, dir: (dir ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC' }
        return qb as QueryBuilder<Row>
      },
      async first() { return (matched()[0] ?? null) as Row | null },
      async get()   { return matched() },
      async create(data: Record<string, unknown>) {
        const n = (counters.get(state.table) ?? 0) + 1
        counters.set(state.table, n)
        const now = new Date()
        const row: Row = { id: `${state.table}-${n}`, createdAt: now, updatedAt: now, ...data }
        rowsFor(state.table).push(row)
        return row
      },
      async updateAll(data: Record<string, unknown>) {
        const rows = matched()
        for (const r of rows) Object.assign(r, data)
        return rows.length
      },
      async deleteAll() {
        const all = rowsFor(state.table)
        const hits = matched()
        for (const r of hits) all.splice(all.indexOf(r), 1)
        return hits.length
      },
    }
    return qb as QueryBuilder<Row>
  }

  const adapter = {
    query(table: string) {
      return build({ table, wheres: [], order: null })
    },
  } as unknown as OrmAdapter

  return { adapter, tables }
}

// ─── Tests ─────────────────────────────────────────────────

describe('OrmConversationStore', () => {
  let store: OrmConversationStore
  let tables: Map<string, Row[]>

  beforeEach(() => {
    const a = makeAdapter()
    tables = a.tables
    ModelRegistry.set(a.adapter)
    store = new OrmConversationStore()
  })

  it('create() persists a thread row with title + meta and returns its id', async () => {
    const id = await store.create('My chat', { userId: 'u-1', agent: 'ChatAgent' })
    const threads = tables.get('aiConversation')!
    assert.equal(threads.length, 1)
    assert.equal(threads[0]!.id, id)
    assert.equal(threads[0]!.title, 'My chat')
    assert.equal(threads[0]!.userId, 'u-1')
    assert.equal(threads[0]!.agent, 'ChatAgent')
  })

  it('create() defaults the title when omitted', async () => {
    await store.create()
    assert.equal(tables.get('aiConversation')![0]!.title, 'New conversation')
  })

  it('append() then load() round-trips messages in order, incl. content shapes', async () => {
    const id = await store.create(undefined, { userId: 'u-1' })
    const messages: AiMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'weather', arguments: { city: 'NYC' } }] },
      { role: 'tool', content: '72F', toolCallId: 'c1' },
      { role: 'assistant', content: [{ type: 'text', text: 'It is 72F.' }] },
    ]
    await store.append(id, messages)

    const loaded = await store.load(id)
    assert.deepStrictEqual(loaded, messages)
  })

  it('append() assigns monotonic positions across multiple calls', async () => {
    const id = await store.create()
    await store.append(id, [{ role: 'user', content: 'one' }])
    await store.append(id, [{ role: 'assistant', content: 'two' }, { role: 'user', content: 'three' }])

    const loaded = await store.load(id)
    assert.deepStrictEqual(loaded.map(m => m.content), ['one', 'two', 'three'])
    const positions = tables.get('aiConversationMessage')!.map(r => r.position)
    assert.deepStrictEqual(positions, [0, 1, 2])
  })

  it('append() bumps the thread updatedAt', async () => {
    const id = await store.create()
    const before = tables.get('aiConversation')![0]!.updatedAt as Date
    await new Promise(r => setTimeout(r, 5))
    await store.append(id, [{ role: 'user', content: 'hi' }])
    const after = tables.get('aiConversation')![0]!.updatedAt as Date
    assert.ok(after.getTime() >= before.getTime())
  })

  it('append() with an empty array is a no-op', async () => {
    const id = await store.create()
    await store.append(id, [])
    assert.equal(tables.get('aiConversationMessage')?.length ?? 0, 0)
  })

  it('load() throws for an unknown thread', async () => {
    await assert.rejects(() => store.load('nope'), /Conversation "nope" not found/)
  })

  it('append() throws for an unknown thread', async () => {
    await assert.rejects(() => store.append('nope', [{ role: 'user', content: 'x' }]), /not found/)
  })

  it('setTitle() updates the row and throws for an unknown thread', async () => {
    const id = await store.create('old')
    await store.setTitle(id, 'new')
    assert.equal(tables.get('aiConversation')![0]!.title, 'new')
    await assert.rejects(() => store.setTitle('nope', 'x'), /not found/)
  })

  it('list() filters by userId, orders by updatedAt DESC, and surfaces agent', async () => {
    const a = await store.create('A', { userId: 'u-1', agent: 'ChatAgent' })
    await store.create('B', { userId: 'u-2' })
    await new Promise(r => setTimeout(r, 5))
    const c = await store.create('C', { userId: 'u-1' })
    // Touch A so it becomes most-recent.
    await new Promise(r => setTimeout(r, 5))
    await store.append(a, [{ role: 'user', content: 'hi' }])

    const list = await store.list('u-1')
    assert.deepStrictEqual(list.map(e => e.id), [a, c])
    assert.equal(list.find(e => e.id === a)!.agent, 'ChatAgent')
    assert.equal(list.find(e => e.id === c)!.agent, undefined)
  })

  it('list() with no userId returns every thread', async () => {
    await store.create('A', { userId: 'u-1' })
    await store.create('B', { userId: 'u-2' })
    const list = await store.list()
    assert.equal(list.length, 2)
  })

  it('delete() removes the thread and its messages', async () => {
    const id = await store.create()
    await store.append(id, [{ role: 'user', content: 'hi' }])
    await store.delete(id)
    assert.equal(tables.get('aiConversation')!.length, 0)
    assert.equal(tables.get('aiConversationMessage')!.length, 0)
  })
})

// ─── Misc ──────────────────────────────────────────────────

describe('conversation-orm exports', () => {
  it('ormConversationStore() returns an OrmConversationStore', () => {
    assert.ok(ormConversationStore() instanceof OrmConversationStore)
  })

  it('Models expose the expected tables', () => {
    assert.equal(AiConversationRecord.table, 'aiConversation')
    assert.equal(AiConversationMessageRecord.table, 'aiConversationMessage')
  })

  it('ships a Prisma schema reference covering both models', () => {
    assert.match(conversationOrmPrismaSchema, /model AiConversation \{/)
    assert.match(conversationOrmPrismaSchema, /model AiConversationMessage \{/)
  })
})
