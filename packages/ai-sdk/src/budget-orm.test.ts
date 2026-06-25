import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { ModelRegistry, type OrmAdapter, type QueryBuilder, type WhereClause } from '@rudderjs/orm'

import {
  BudgetUsageRecord,
  OrmBudgetStorage,
  ormBudgetStorage,
  budgetUsagePrismaSchema,
} from './budget-orm/index.js'

// ─── In-memory adapter ────────────────────────────────────
//
// Minimal stub — supports just the operations OrmBudgetStorage uses
// (where + first, create, increment, deleteAll). Throws on anything else
// so we catch silent regressions if the storage starts depending on a
// new query method.

interface Row {
  id:        string
  userId:    string
  period:    string
  periodKey: string
  spent:     number
  createdAt: Date
  updatedAt: Date | null
}

interface State {
  wheres: WhereClause[]
}

function makeAdapter(rows: Row[]): { adapter: OrmAdapter; rows: Row[] } {
  let nextId = 1

  function build(state: State): QueryBuilder<Row> {
    const qb: QueryBuilder<Row> = {
      where(col: string, opOrVal?: unknown, value?: unknown) {
        const operator = (arguments.length === 3 ? opOrVal : '=') as WhereClause['operator']
        const val      = arguments.length === 3 ? value : opOrVal
        state.wheres.push({ column: col, operator, value: val })
        return qb
      },
      orWhere() { return qb },
      orderBy() { return qb },
      limit()    { return qb },
      offset()   { return qb },
      with()     { return qb },
      withPivot(){ return qb },
      whereGroup(){ return qb },
      whereHas() { return qb },
      whereDoesntHave() { return qb },
      withCount(){ return qb },
      withSum() { return qb },
      withMin() { return qb },
      withMax() { return qb },
      withAvg() { return qb },
      withExists(){ return qb },
      withTrashed(){ return qb },
      onlyTrashed(){ return qb },
      withoutTrashed(){ return qb },
      scope() { return qb },
      withoutGlobalScope() { return qb },

      async first() {
        const matched = rows.filter(r => state.wheres.every(w => (r as unknown as Record<string, unknown>)[w.column] === w.value))
        return (matched[0] ?? null) as Row | null
      },
      async get() {
        return rows.filter(r => state.wheres.every(w => (r as unknown as Record<string, unknown>)[w.column] === w.value))
      },
      async find(id: string | number) {
        return (rows.find(r => r.id === String(id)) ?? null) as Row | null
      },
      async findOrFail(id: string | number) {
        const r = await qb.find(id)
        if (!r) throw new Error('not found')
        return r as Row
      },
      async firstOrFail() {
        const r = await qb.first()
        if (!r) throw new Error('not found')
        return r as Row
      },
      async paginate() { throw new Error('paginate not implemented in stub') },
      async count() {
        const matched = rows.filter(r => state.wheres.every(w => (r as unknown as Record<string, unknown>)[w.column] === w.value))
        return matched.length
      },
      async exists() { return (await qb.count()) > 0 },
      async sum() { throw new Error('sum not implemented in stub') },
      async min() { throw new Error('min not implemented in stub') },
      async max() { throw new Error('max not implemented in stub') },
      async avg() { throw new Error('avg not implemented in stub') },

      async create(data: Record<string, unknown>) {
        const now = new Date()
        const row: Row = {
          id:        String(nextId++),
          userId:    String(data['userId'] ?? ''),
          period:    String(data['period'] ?? ''),
          periodKey: String(data['periodKey'] ?? ''),
          spent:     Number(data['spent'] ?? 0),
          createdAt: now,
          updatedAt: null,
        }
        // Honor the unique constraint — first-write race protection.
        const dup = rows.find(r =>
          r.userId    === row.userId &&
          r.period    === row.period &&
          r.periodKey === row.periodKey,
        )
        if (dup) throw new Error('Unique constraint violation: (userId, period, periodKey)')
        rows.push(row)
        return row
      },
      async update() { throw new Error('update not implemented in stub') },
      async delete() { throw new Error('delete not implemented in stub') },
      async deleteAll() {
        const matched = rows.filter(r => state.wheres.every(w => (r as unknown as Record<string, unknown>)[w.column] === w.value))
        for (const r of matched) {
          const idx = rows.indexOf(r)
          if (idx >= 0) rows.splice(idx, 1)
        }
        return matched.length
      },
      async insertMany() { throw new Error('insertMany not implemented in stub') },
      async firstOrCreate() { throw new Error('firstOrCreate not implemented in stub') },
      async updateOrCreate() { throw new Error('updateOrCreate not implemented in stub') },
      async restore() { throw new Error('restore not implemented in stub') },
      async forceDelete() { throw new Error('forceDelete not implemented in stub') },

      async increment(id: string, column: string, amount?: number) {
        const row = rows.find(r => r.id === id)
        if (!row) throw new Error(`row ${String(id)} not found`)
        const r = row as unknown as Record<string, unknown>
        r[column] = Number(r[column] ?? 0) + (amount ?? 1)
        return row
      },
      async decrement(id: string, column: string, amount?: number) {
        const row = rows.find(r => r.id === id)
        if (!row) throw new Error(`row ${String(id)} not found`)
        const r = row as unknown as Record<string, unknown>
        r[column] = Number(r[column] ?? 0) - (amount ?? 1)
        return row
      },
      async withAggregate() { throw new Error('withAggregate not implemented in stub') },
      async _aggregate() { throw new Error('_aggregate not implemented in stub') },
    } as unknown as QueryBuilder<Row>

    return qb
  }

  const adapter: OrmAdapter = {
    query() {
      const state: State = { wheres: [] }
      return build(state)
    },
  } as unknown as OrmAdapter

  return { adapter, rows }
}

// ─── Tests ─────────────────────────────────────────────────

describe('OrmBudgetStorage', () => {
  let rows: Row[]

  beforeEach(() => {
    const a = makeAdapter([])
    rows = a.rows
    ModelRegistry.set(a.adapter)
  })

  it('first debit creates the row with the correct (userId, period, periodKey, spent)', async () => {
    const s = new OrmBudgetStorage()
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.3, now: new Date('2026-05-12T12:00:00Z') })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.3)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.userId,    'u-1')
    assert.equal(rows[0]!.period,    'daily')
    assert.equal(rows[0]!.periodKey, '2026-05-12')
    assert.equal(rows[0]!.spent,     0.3)
  })

  it('subsequent debits increment the existing row', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.3 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.4 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.7)
    assert.equal(rows.length, 1) // still one row
    assert.equal(rows[0]!.spent, 0.7)
  })

  it('refuses when cumulative spend would exceed cap; spent reflects pre-debit value', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.8 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.3 })
    assert.equal(r.allowed, false)
    assert.equal(r.spent,   0.8)
    assert.equal(rows[0]!.spent, 0.8) // counter unchanged on denial
  })

  it('refuses first-write when a single debit alone would exceed cap; no row created', async () => {
    const s = new OrmBudgetStorage()
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 0.5, costUsd: 1.0 })
    assert.equal(r.allowed, false)
    assert.equal(r.spent,   0)
    assert.equal(rows.length, 0) // important: don't pollute storage with denied requests
  })

  it('costUsd: 0 is a pure read — does not mutate, returns current spent', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.42 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.42)
    assert.equal(rows[0]!.spent, 0.42)
  })

  it('costUsd: 0 on an empty bucket reads 0 without creating a row', async () => {
    const s = new OrmBudgetStorage()
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0)
    assert.equal(rows.length, 0)
  })

  it('isolates users — same period, different userId is a different row', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'a', period: 'daily', cap: 1, costUsd: 0.9 })
    const r = await s.checkAndDebit({ userId: 'b', period: 'daily', cap: 1, costUsd: 0.9 })
    assert.equal(r.allowed, true)
    assert.equal(rows.length, 2)
  })

  it('isolates periods — same user, daily and monthly are independent rows', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily',   cap: 1, costUsd: 0.9, now: new Date('2026-05-12T12:00:00Z') })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 1, costUsd: 0.9, now: new Date('2026-05-12T12:00:00Z') })
    assert.equal(r.allowed, true)
    assert.equal(rows.length, 2)
    assert.equal(rows[0]!.period, 'daily')
    assert.equal(rows[1]!.period, 'monthly')
  })

  it('rolls counters at midnight — different day → fresh row', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.9, now: new Date('2026-05-11T15:00:00Z') })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.9, now: new Date('2026-05-12T15:00:00Z') })
    assert.equal(r.allowed, true)
    assert.equal(rows.length, 2)
  })

  it('honors timezone for period rollover — same-day-PST creates one row', async () => {
    const s = new OrmBudgetStorage()
    // 20:30 UTC = 13:30 PST and 06:30 UTC next day = 23:30 PST same day.
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.4, now: new Date('2026-05-11T20:30:00Z'), timezone: 'America/Los_Angeles' })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.4, now: new Date('2026-05-12T06:30:00Z'), timezone: 'America/Los_Angeles' })
    assert.equal(r.allowed, true)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.spent, 0.8)
    assert.equal(rows[0]!.periodKey, '2026-05-11') // PST date
  })

  it('rejects negative cap and negative costUsd at validation time', async () => {
    const s = new OrmBudgetStorage()
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: -1, costUsd: 0.1 }),
      /cap must be a non-negative finite number/,
    )
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: -0.1 }),
      /costUsd must be a non-negative finite number/,
    )
  })

  it('reset clears the bucket for the (userId, period) at `now`', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.5, now: new Date('2026-05-12T12:00:00Z') })
    await s.reset('u-1', 'daily', new Date('2026-05-12T12:00:00Z'))
    assert.equal(rows.length, 0)
  })

  it('reset does not affect a different period for the same user', async () => {
    const s = new OrmBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily',   cap: 1, costUsd: 0.5 })
    await s.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 1, costUsd: 0.5 })
    await s.reset('u-1', 'daily')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.period, 'monthly')
  })

  it('first-write race: two concurrent first-writes for the same user produce ONE row', async () => {
    // Race scenario: two workers both `first()` and see no row, both `create()`. The unique
    // constraint catches the second insert; the storage refetches and applies the increment
    // path instead. Total spend ends at the sum of both debits, not at one of them.
    const s = new OrmBudgetStorage()

    const r1 = s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.3 })
    const r2 = s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: 0.4 })
    const [a, b] = await Promise.all([r1, r2])

    assert.equal(rows.length, 1, 'expected exactly one row after concurrent first-writes')
    assert.ok(Math.abs(rows[0]!.spent - 0.7) < 1e-9,
      `expected spent = 0.7, got ${rows[0]!.spent}`)
    // Both should have been allowed (sum 0.7 ≤ cap 1).
    assert.equal(a.allowed, true)
    assert.equal(b.allowed, true)
  })
})

// ─── ormBudgetStorage factory + schema export ─────────────

describe('ormBudgetStorage factory + schema export', () => {
  it('factory returns a BudgetStorage', () => {
    const s = ormBudgetStorage()
    assert.equal(typeof s.checkAndDebit, 'function')
    assert.equal(typeof s.reset,         'function')
  })

  it('budgetUsagePrismaSchema exports the canonical model definition with the unique constraint', () => {
    assert.match(budgetUsagePrismaSchema, /model BudgetUsage \{/)
    assert.match(budgetUsagePrismaSchema, /@@unique\(\[userId, period, periodKey\]\)/)
    assert.match(budgetUsagePrismaSchema, /spent\s+Float/)
  })

  it('exports BudgetUsageRecord with the correct table name', () => {
    assert.equal(BudgetUsageRecord.table, 'budgetUsage')
  })
})
