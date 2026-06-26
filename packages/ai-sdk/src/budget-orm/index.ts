/**
 * `@gemstack/ai-sdk/budget-orm` — ORM-backed {@link BudgetStorage} for #A6 Phase 4.
 *
 * Production-grade replacement for `memoryBudgetStorage()` (which is
 * single-process only). Persists per-user spend counters in a
 * `BudgetUsage` table via the registered `@rudderjs/orm` adapter — works
 * across queue workers, web processes, and horizontally-scaled deployments.
 *
 * Wire it into your AI middleware:
 *
 * ```ts
 * import { withBudget } from '@gemstack/ai-sdk'
 * import { ormBudgetStorage } from '@gemstack/ai-sdk/budget-orm'
 *
 * const budgeted = withBudget({
 *   user:    (ctx) => ctx.context as string,
 *   budget:  () => ({ daily: 0.50, monthly: 10 }),
 *   storage: ormBudgetStorage(),
 * })
 * ```
 *
 * The schema lives at {@link budgetUsagePrismaSchema} — copy it into your
 * Prisma schema (or a new `prisma/schema/<file>.prisma` if you use the
 * multi-file setup). The `@@unique([userId, period, periodKey])`
 * constraint is the one load-bearing index — without it, the
 * find-or-create path can race and produce duplicate rows.
 *
 * # Atomicity caveat
 *
 * `checkAndDebit` does a read-then-conditional-increment. The increment
 * itself is atomic (`UPDATE col = col + n`), but the cap check sits
 * between the read and the write. Under high concurrency for a single
 * user (more than ~1 in-flight budgeted request at a time), total spend
 * can briefly exceed `cap` by up to `costUsd × concurrency`. For typical
 * apps this is a non-issue.
 *
 * Strict guarantees require a database transaction with serializable
 * isolation or a Redis-backed counter — both planned as follow-ups. File
 * an issue if you hit this in production.
 */

import { Model } from '@rudderjs/orm'
import {
  type BudgetCheckOptions,
  type BudgetCheckResult,
  type BudgetPeriod,
  type BudgetStorage,
  periodKey as buildPeriodKey,
} from '../budget/storage.js'

// ─── ORM Model ────────────────────────────────────────────

/**
 * Model row backing {@link OrmBudgetStorage}. Exposed so apps that
 * want admin views (e.g. "show me top spenders this month") can use
 * `BudgetUsageRecord.where(...).get()` instead of routing every read
 * through the {@link BudgetStorage} interface.
 *
 * The `@@unique([userId, period, periodKey])` constraint is required —
 * without it, two concurrent first-writes for the same user/period
 * create duplicate rows and the cap accounting silently drifts.
 */
export class BudgetUsageRecord extends Model {
  static override table    = 'budgetUsage'
  static override fillable = ['userId', 'period', 'periodKey', 'spent']

  declare id:        string
  declare userId:    string
  /** `'daily'` or `'monthly'`. */
  declare period:    string
  /** TZ-aware bucket key — `YYYY-MM-DD` (daily) or `YYYY-MM` (monthly). */
  declare periodKey: string
  /** Cumulative USD spend in this period. */
  declare spent:     number
  declare createdAt: Date
  declare updatedAt: Date | null
}

// ─── BudgetStorage adapter ────────────────────────────────

/**
 * Production `BudgetStorage` backed by the registered `@rudderjs/orm`
 * adapter. See the module JSDoc for setup + the atomicity caveat.
 */
export class OrmBudgetStorage implements BudgetStorage {
  async checkAndDebit(opts: BudgetCheckOptions): Promise<BudgetCheckResult> {
    if (!Number.isFinite(opts.cap) || opts.cap < 0) {
      throw new Error(`[ai-sdk] BudgetStorage: cap must be a non-negative finite number, got ${opts.cap}`)
    }
    if (!Number.isFinite(opts.costUsd) || opts.costUsd < 0) {
      throw new Error(`[ai-sdk] BudgetStorage: costUsd must be a non-negative finite number, got ${opts.costUsd}`)
    }

    const now = opts.now ?? new Date()
    const key = buildPeriodKey(opts.period, now, opts.timezone)

    const existing = await BudgetUsageRecord
      .where('userId',    opts.userId)
      .where('period',    opts.period)
      .where('periodKey', key)
      .first() as unknown as BudgetUsageRecord | null

    // ─── No row yet — first write for this period ─────────
    if (!existing) {
      // Pure-read on an empty bucket — still empty after.
      if (opts.costUsd === 0) {
        return { allowed: true, spent: 0, cap: opts.cap }
      }
      // Single debit larger than cap — refuse before creating the row,
      // so we don't pollute storage with denied requests.
      if (opts.costUsd > opts.cap) {
        return { allowed: false, spent: 0, cap: opts.cap }
      }

      try {
        await BudgetUsageRecord.create({
          userId:    opts.userId,
          period:    opts.period,
          periodKey: key,
          spent:     opts.costUsd,
        })
        return { allowed: true, spent: opts.costUsd, cap: opts.cap }
      } catch (e) {
        // Race: another caller created the row between our `first()` and
        // `create()`. Re-read and fall through to the increment path.
        // We deliberately don't sniff the error type — any create failure
        // means the row may now exist; let the re-read decide.
        const refetched = await BudgetUsageRecord
          .where('userId',    opts.userId)
          .where('period',    opts.period)
          .where('periodKey', key)
          .first() as unknown as BudgetUsageRecord | null
        if (!refetched) throw e  // not a unique-constraint race; surface the original error
        return this._applyIncrementPath(refetched, opts)
      }
    }

    return this._applyIncrementPath(existing, opts)
  }

  /** Apply the read-then-conditional-increment path on an existing row. */
  private async _applyIncrementPath(
    row:  BudgetUsageRecord,
    opts: BudgetCheckOptions,
  ): Promise<BudgetCheckResult> {
    const current = Number(row.spent ?? 0)

    // Pure read.
    if (opts.costUsd === 0) {
      return { allowed: true, spent: current, cap: opts.cap }
    }

    // Cap check — read-then-decide. Atomic under single-writer; under
    // concurrent writers, see the module-level atomicity caveat.
    if (current + opts.costUsd > opts.cap) {
      return { allowed: false, spent: current, cap: opts.cap }
    }

    const updated = await BudgetUsageRecord.increment(row.id, 'spent', opts.costUsd) as unknown as BudgetUsageRecord
    const newSpent = Number(updated?.spent ?? current + opts.costUsd)
    return { allowed: true, spent: newSpent, cap: opts.cap }
  }

  async reset(userId: string, period: BudgetPeriod, now?: Date, timezone?: string): Promise<void> {
    const key = buildPeriodKey(period, now ?? new Date(), timezone)
    await BudgetUsageRecord
      .where('userId',    userId)
      .where('period',    period)
      .where('periodKey', key)
      .deleteAll()
  }
}

/**
 * Convenience factory — returns a fresh {@link OrmBudgetStorage}
 * instance. Prefer this over `new OrmBudgetStorage()` for symmetry with
 * `memoryBudgetStorage()`.
 */
export function ormBudgetStorage(): BudgetStorage {
  return new OrmBudgetStorage()
}

// ─── Schema reference ─────────────────────────────────────

/**
 * Reference Prisma schema for `OrmBudgetStorage`. Copy into your
 * `prisma/schema/<file>.prisma` (or paste alongside an existing model).
 *
 * The `@@unique([userId, period, periodKey])` constraint is required —
 * without it the find-or-create path can race and produce duplicate
 * rows, breaking cap accounting.
 *
 * SQLite stores `Float` as `REAL`; Postgres / MySQL as `DOUBLE
 * PRECISION` / `DOUBLE`. All three give 15+ significant digits — more
 * than enough for sub-cent budget tracking.
 */
export const budgetUsagePrismaSchema = `model BudgetUsage {
  id        String   @id @default(cuid())
  userId    String
  /// 'daily' | 'monthly'
  period    String
  /// YYYY-MM-DD (daily) or YYYY-MM (monthly), in the configured timezone
  periodKey String
  /// Cumulative USD spend in this period
  spent     Float    @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, period, periodKey])
  @@index([userId])
}
`
