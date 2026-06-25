import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  memoryBudgetStorage,
  periodKey,
  type BudgetStorage,
} from './budget/storage.js'

// ─── periodKey ────────────────────────────────────────────

describe('periodKey', () => {
  it('formats daily as YYYY-MM-DD in UTC by default', () => {
    const d = new Date('2026-05-11T15:30:00Z')
    assert.equal(periodKey('daily', d), '2026-05-11')
  })

  it('formats monthly as YYYY-MM in UTC by default', () => {
    const d = new Date('2026-05-11T15:30:00Z')
    assert.equal(periodKey('monthly', d), '2026-05')
  })

  it('honors IANA timezone — TZ rollover before UTC midnight is yesterday in PST', () => {
    // 2026-05-12T03:30:00Z is 2026-05-11T20:30 PST. Same date in PST,
    // next date in UTC. Use a fixed-offset zone that won't drift with DST.
    const d = new Date('2026-05-12T03:30:00Z')
    assert.equal(periodKey('daily', d, 'America/Los_Angeles'), '2026-05-11')
    assert.equal(periodKey('daily', d, 'UTC'),                 '2026-05-12')
  })

  it('honors IANA timezone — TZ rollover crosses month boundary', () => {
    // 2026-06-01T05:30:00Z is 2026-05-31T22:30 PST. Different MONTH in PST vs UTC.
    const d = new Date('2026-06-01T05:30:00Z')
    assert.equal(periodKey('monthly', d, 'America/Los_Angeles'), '2026-05')
    assert.equal(periodKey('monthly', d, 'UTC'),                 '2026-06')
  })
})

// ─── memoryBudgetStorage — basic semantics ────────────────

describe('memoryBudgetStorage — checkAndDebit', () => {
  it('allows the debit when spent + cost stays at or under cap; spent reflects post-debit', async () => {
    const s = memoryBudgetStorage()
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.30 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.30)
    assert.equal(r.cap,     1.00)
  })

  it('denies the debit when it would exceed cap; spent reflects pre-debit (the unchanged prior value)', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.80 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.30 })
    assert.equal(r.allowed, false)
    // BEFORE the rejected debit — the user has spent 0.80, not 1.10.
    assert.equal(r.spent,   0.80)
    assert.equal(r.cap,     1.00)
  })

  it('treats cap exactly equal to spent + cost as allowed (≤ not <)', async () => {
    const s = memoryBudgetStorage()
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 1.00 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   1.00)
  })

  it('costUsd: 0 is a pure read — does not mutate, returns current spent', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.42 })
    const peek = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0 })
    assert.equal(peek.allowed, true)
    assert.equal(peek.spent,   0.42)
    // And a follow-up read still sees the same — the pure read didn't double-count.
    const peek2 = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0 })
    assert.equal(peek2.spent,  0.42)
  })

  it('isolates users — same period, different userId is a different bucket', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'a', period: 'daily', cap: 1.00, costUsd: 0.90 })
    const r = await s.checkAndDebit({ userId: 'b', period: 'daily', cap: 1.00, costUsd: 0.90 })
    assert.equal(r.allowed, true) // user b unaffected
    assert.equal(r.spent,   0.90)
  })

  it('isolates periods — same user, daily and monthly are independent counters', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily',   cap: 1.00, costUsd: 0.90 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 1.00, costUsd: 0.90 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.90)
  })

  it('rolls counters at midnight — same user, different day → fresh budget', async () => {
    const s = memoryBudgetStorage()
    const day1 = new Date('2026-05-11T15:00:00Z')
    const day2 = new Date('2026-05-12T15:00:00Z')
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.90, now: day1 })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.90, now: day2 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.90)
  })

  it('honors timezone for period rollover — PST midnight rolls before UTC midnight', async () => {
    const s = memoryBudgetStorage()
    // Both timestamps fall in 2026-05-11 in PST (the second is 23:30 PST).
    // In UTC, the second is 2026-05-12T07:30 — different day.
    const a = new Date('2026-05-11T20:30:00Z') // 2026-05-11 13:30 PST
    const b = new Date('2026-05-12T06:30:00Z') // 2026-05-11 23:30 PST
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.60, now: a, timezone: 'America/Los_Angeles' })
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.60, now: b, timezone: 'America/Los_Angeles' })
    // Same PST day, second debit should be denied — total would be 1.20, cap is 1.00.
    assert.equal(r.allowed, false)
  })

  it('rejects negative cap and negative costUsd at validation time', async () => {
    const s = memoryBudgetStorage()
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: -1, costUsd: 0.1 }),
      /cap must be a non-negative finite number/,
    )
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1, costUsd: -0.1 }),
      /costUsd must be a non-negative finite number/,
    )
  })

  it('rejects NaN and Infinity', async () => {
    const s = memoryBudgetStorage()
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: NaN,      costUsd: 0.1 }),
      /cap must be a non-negative finite number/,
    )
    await assert.rejects(
      () => s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: Infinity, costUsd: 0.1 }),
      /cap must be a non-negative finite number/,
    )
  })
})

// ─── memoryBudgetStorage — reset ──────────────────────────

describe('memoryBudgetStorage — reset', () => {
  it('clears the counter for the (userId, period) at `now`', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.90 })
    await s.reset!('u-1', 'daily')
    const r = await s.checkAndDebit({ userId: 'u-1', period: 'daily', cap: 1.00, costUsd: 0.90 })
    assert.equal(r.allowed, true)
    assert.equal(r.spent,   0.90)
  })

  it('does not affect a different period for the same user', async () => {
    const s = memoryBudgetStorage()
    await s.checkAndDebit({ userId: 'u-1', period: 'daily',   cap: 1.00, costUsd: 0.50 })
    await s.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 1.00, costUsd: 0.50 })
    await s.reset!('u-1', 'daily')
    const peek = await s.checkAndDebit({ userId: 'u-1', period: 'monthly', cap: 1.00, costUsd: 0 })
    assert.equal(peek.spent, 0.50) // monthly untouched
  })
})

// ─── memoryBudgetStorage — concurrency / atomicity ────────

describe('memoryBudgetStorage — atomic check-and-debit', () => {
  it('100 concurrent debits at the cap line — exactly floor(cap/cost) succeed', async () => {
    // The interesting failure mode: each call reads spent=0, computes 0 + cost ≤ cap,
    // and writes cost — total spend ends at cost instead of cap × ratio. With true
    // atomicity, only floor(cap/cost) callers see allowed: true.
    //
    // Cost 0.5 + cap 4 chosen because 0.5 is an exact IEEE 754 fraction (1/2), so
    // 8 iterations sum to exactly 4.0. Avoid 0.1 / 0.05 etc. — those don't round-trip
    // and the 8th increment ends up at 4.0000000000000004, denying one valid debit.
    const s = memoryBudgetStorage()
    const opts = { userId: 'u-1' as const, period: 'daily' as const, cap: 4, costUsd: 0.5 }
    const results = await Promise.all(
      Array.from({ length: 100 }, () => s.checkAndDebit(opts)),
    )
    const allowed = results.filter((r) => r.allowed).length
    const denied  = results.filter((r) => !r.allowed).length
    assert.equal(allowed, 8, `expected 8 of 100 allowed (cap 4 / cost 0.5), got ${allowed}`)
    assert.equal(denied,  92)

    // Final spent value should match exactly the sum of allowed debits.
    const peek = await s.checkAndDebit({ ...opts, costUsd: 0 })
    assert.equal(peek.spent, 4)
  })

  it('mixed concurrent costs — total allowed never exceeds cap', async () => {
    const s = memoryBudgetStorage()
    const opts = { userId: 'u-1' as const, period: 'daily' as const, cap: 1.00 }
    const costs = [0.10, 0.40, 0.30, 0.20, 0.15, 0.50, 0.05, 0.25, 0.35, 0.45]
    const results = await Promise.all(costs.map((c) => s.checkAndDebit({ ...opts, costUsd: c })))
    const totalAllowed = results
      .filter((r) => r.allowed)
      .reduce((sum, r, _i, arr) => arr.length === 0 ? 0 : sum, 0) // dummy — recompute below

    // Recompute from the costs because `r.spent` is the running total at debit time, not the contribution.
    let sum = 0
    for (let i = 0; i < results.length; i++) {
      if (results[i]!.allowed) sum += costs[i]!
    }
    assert.ok(sum <= 1.00 + 1e-9, `total allowed cost ${sum} should not exceed cap 1.00`)
    void totalAllowed // silence unused
  })
})

// ─── BudgetStorage interface — type-level smoke test ──────

describe('BudgetStorage — type contract', () => {
  it('memoryBudgetStorage returns an object satisfying BudgetStorage', () => {
    const s: BudgetStorage = memoryBudgetStorage()
    assert.equal(typeof s.checkAndDebit, 'function')
    assert.equal(typeof s.reset,         'function')
  })
})
