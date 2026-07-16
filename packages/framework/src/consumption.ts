/**
 * Consumption limits (#523, the decision half of #519): how much of the
 * account's subscription The Framework may burn before it pauses itself.
 *
 * Everything here is denominated in **points of the weekly meter** — one point
 * is 1% of the account's weekly allowance, the one real number the agent gives
 * us (#521). Rom's limits chain down from it: a day may spend 20% of the week,
 * and a rolling 5h / a single session may spend 60% / 40% of that day. So the
 * budgets work out to 20, 12 and 8 points respectively.
 *
 * The meter is account-wide: it counts the user's own interactive work too, not
 * only ours (Rom's call on #519). That errs towards pausing early, which is the
 * point of the feature.
 */

/** A rolling 5-hour window, in ms. Matches the agent's own session window. */
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

/** A rolling day, in ms. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** One reading of the weekly meter. */
export interface QuotaSample {
  /** When it was read, epoch ms. */
  at: number
  /** The account's weekly allowance consumed so far, 0-100. */
  weeklyPercent: number
}

/** Consumption across a window, and how much of that window we can actually vouch for. */
export interface RollingConsumption {
  /** Points of the weekly meter consumed across {@link coveredMs}. */
  points: number
  /**
   * How much of the requested window the samples really span. Shorter than the
   * window whenever we weren't watching for all of it (the daemon was down, or
   * this is a cold start).
   */
  coveredMs: number
  /** Whether the samples span the whole window, i.e. {@link points} is the full story. */
  complete: boolean
}

/**
 * A rolling record of the weekly meter, from which consumption over any recent
 * window can be derived.
 *
 * Keeping samples rather than a running total is what makes the weekly reset
 * tractable: the meter drops to ~0 at the boundary, and only the raw readings
 * let us tell "the week rolled over" apart from "nothing was spent".
 */
export class ConsumptionMeter {
  private samples: QuotaSample[] = []

  /**
   * Record a reading. Out-of-order readings are dropped rather than sorted in:
   * they'd corrupt the reset detection, which reads meaning into a drop between
   * *consecutive* samples.
   */
  record(sample: QuotaSample): void {
    const last = this.samples[this.samples.length - 1]
    if (last && sample.at < last.at) return
    this.samples.push(sample)
  }

  /** Drop samples older than `keepMs` before `now`, keeping the one that spans the boundary. */
  prune(now: number, keepMs = ONE_DAY_MS): void {
    const cutoff = now - keepMs
    // Keep the newest sample at-or-before the cutoff: it's the baseline the
    // widest window measures from, so dropping it would shorten our coverage.
    let keepFrom = 0
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]
      if (s && s.at <= cutoff) keepFrom = i
      else break
    }
    if (keepFrom > 0) this.samples = this.samples.slice(keepFrom)
  }

  /** The most recent reading, if any. */
  latest(): QuotaSample | undefined {
    return this.samples[this.samples.length - 1]
  }

  /** How many readings are held. */
  get size(): number {
    return this.samples.length
  }

  /**
   * Consumption since `from` (epoch ms), measured from the newest sample at or
   * before it. `undefined` when there is nothing to measure against, which is
   * "we don't know" and must not be read as zero.
   */
  since(from: number, now = Date.now()): RollingConsumption | undefined {
    if (this.samples.length === 0) return undefined
    let baselineIndex = 0
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i]
      if (s && s.at <= from) baselineIndex = i
    }
    const baseline = this.samples[baselineIndex]
    if (!baseline) return undefined
    const windowMs = Math.max(0, now - from)
    const spannedMs = Math.max(0, now - baseline.at)
    return {
      points: this.consumedFrom(baselineIndex),
      coveredMs: Math.min(windowMs, spannedMs),
      // The baseline predates the window, so the samples span all of it.
      complete: baseline.at <= from,
    }
  }

  /** Consumption across the last `windowMs`. `undefined` when there is nothing to measure. */
  rolling(windowMs: number, now = Date.now()): RollingConsumption | undefined {
    return this.since(now - windowMs, now)
  }

  /**
   * Sum consumption from `startIndex` to the newest sample.
   *
   * A drop between consecutive readings means the weekly window reset, so
   * everything on the meter after it was spent since the reset: that segment
   * contributes the new reading outright, not a negative delta.
   */
  private consumedFrom(startIndex: number): number {
    let total = 0
    for (let i = startIndex + 1; i < this.samples.length; i++) {
      const prev = this.samples[i - 1]
      const cur = this.samples[i]
      if (!prev || !cur) continue
      total += cur.weeklyPercent >= prev.weeklyPercent ? cur.weeklyPercent - prev.weeklyPercent : cur.weeklyPercent
    }
    return total
  }
}

/** One of Rom's three limits. */
export type ConsumptionWindow = 'session' | 'five-hour' | 'daily'

/** How each limit reads in a log line and a stop reason. */
export const CONSUMPTION_LIMIT_LABEL: Record<ConsumptionWindow, string> = {
  session: 'Session',
  'five-hour': '5h',
  daily: 'Daily',
}

/** A single limit: a share, and whether it's on. */
export interface ConsumptionLimit {
  enabled: boolean
  /** The share this limit allows, as a percentage of what it's measured against. */
  percent: number
}

/**
 * The three limits (#519). `daily` is a share of the weekly allowance; the other
 * two are shares of whatever `daily` works out to, so raising the day's budget
 * raises all three together.
 */
export interface ConsumptionLimits {
  /** Share of the weekly allowance one day may consume. */
  daily: ConsumptionLimit
  /** Share of the day's budget a rolling 5h may consume. */
  fiveHour: ConsumptionLimit
  /** Share of the day's budget one session may consume. */
  session: ConsumptionLimit
}

/** Rom's defaults (#519). */
export const DEFAULT_CONSUMPTION_LIMITS: ConsumptionLimits = {
  daily: { enabled: true, percent: 20 },
  fiveHour: { enabled: true, percent: 60 },
  session: { enabled: true, percent: 40 },
}

const CONSUMPTION_LIMIT_KEYS = ['daily', 'fiveHour', 'session'] as const

/**
 * Read one limit out of a hand-edited or browser-supplied object.
 *
 * `undefined` for anything we can't trust, so the caller falls back to the
 * default rather than to an unguarded account. The percentage is clamped rather
 * than rejected: a plausible-but-out-of-range number is a slip, and honouring
 * the nearest legal value beats silently reverting to something else entirely.
 */
function sanitizeConsumptionLimit(value: unknown): ConsumptionLimit | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  const percent = input['percent']
  if (typeof input['enabled'] !== 'boolean') return undefined
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return undefined
  return { enabled: input['enabled'], percent: Math.min(100, Math.max(0, percent)) }
}

/** Read the three limits, falling back per-limit so one bad entry can't unguard the rest. */
export function sanitizeConsumptionLimits(value: unknown): ConsumptionLimits | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const input = value as Record<string, unknown>
  const limits = {} as ConsumptionLimits
  let any = false
  for (const key of CONSUMPTION_LIMIT_KEYS) {
    const limit = sanitizeConsumptionLimit(input[key])
    if (limit) any = true
    limits[key] = limit ?? DEFAULT_CONSUMPTION_LIMITS[key]
  }
  return any ? limits : undefined
}

/** What each limit works out to, in points of the weekly meter. */
export interface ConsumptionBudgets {
  daily: number
  fiveHour: number
  session: number
}

/** Resolve the limits into weekly-meter points. */
export function budgetsFrom(limits: ConsumptionLimits): ConsumptionBudgets {
  const daily = limits.daily.percent
  return {
    daily,
    fiveHour: (limits.fiveHour.percent / 100) * daily,
    session: (limits.session.percent / 100) * daily,
  }
}

/** Where one limit stands: enough to draw its bar and to know if it's reached. */
export interface LimitStatus {
  enabled: boolean
  /** Points allowed. */
  budget: number
  /** Points consumed, or `undefined` when we have nothing to measure against. */
  consumed: number | undefined
  /** How full the bar is, 0-100. `undefined` mirrors {@link consumed}. */
  usedPercent: number | undefined
  /** Whether the window's figure covers the whole window. */
  complete: boolean
  /** Whether this limit is enabled, measurable, and spent. */
  reached: boolean
}

/** Where all three limits stand. */
export interface ConsumptionStatus {
  session: LimitStatus
  fiveHour: LimitStatus
  daily: LimitStatus
  /**
   * The limit to pause for, or `null`. Widest-first (`daily`, then `five-hour`,
   * then `session`), so what surfaces is the one that takes longest to recover.
   */
  reached: ConsumptionWindow | null
}

function statusFor(limit: ConsumptionLimit, budget: number, consumption: RollingConsumption | undefined): LimitStatus {
  const consumed = consumption?.points
  // No reading is "we don't know", never "nothing spent": treating it as zero
  // would leave every bar empty and every limit unreachable, which is exactly
  // the failure the limits exist to prevent.
  const measurable = consumed !== undefined
  // A zero budget allows nothing, so it is spent the moment we can measure it.
  // Reading it as "never reached" would make 0% a setting that quietly does
  // nothing, which is worse than it plainly stopping the work.
  const spent = measurable && (budget <= 0 || consumed >= budget)
  return {
    enabled: limit.enabled,
    budget,
    consumed,
    usedPercent: !measurable ? undefined : budget <= 0 ? 100 : Math.min(100, (consumed / budget) * 100),
    complete: consumption?.complete ?? false,
    reached: limit.enabled && spent,
  }
}

/**
 * Where the three limits stand, given the meter and when the current session
 * started (#523).
 *
 * A limit that cannot be measured is never *reached*: an unreadable quota
 * shouldn't stop the user's work, and the per-run budget cap (`--max-cost`)
 * still applies underneath. That is a deliberate fail-open.
 */
export function consumptionStatus(input: {
  meter: ConsumptionMeter
  limits: ConsumptionLimits
  /** When the current session started, epoch ms. Omit when nothing is running. */
  sessionStartedAt?: number
  now?: number
}): ConsumptionStatus {
  const now = input.now ?? Date.now()
  const budgets = budgetsFrom(input.limits)
  const daily = statusFor(input.limits.daily, budgets.daily, input.meter.rolling(ONE_DAY_MS, now))
  const fiveHour = statusFor(input.limits.fiveHour, budgets.fiveHour, input.meter.rolling(FIVE_HOURS_MS, now))
  const session = statusFor(
    input.limits.session,
    budgets.session,
    input.sessionStartedAt === undefined ? undefined : input.meter.since(input.sessionStartedAt, now),
  )
  const reached: ConsumptionWindow | null = daily.reached
    ? 'daily'
    : fiveHour.reached
      ? 'five-hour'
      : session.reached
        ? 'session'
        : null
  return { session, fiveHour, daily, reached }
}
