import type { DriverUsage } from './driver/index.js'

/**
 * Cumulative token + cost usage for a run (#322). Extends {@link DriverUsage}
 * with a turn count so a surface can show both the spend and how many agent
 * turns produced it.
 */
export interface UsageTotals extends DriverUsage {
  /** Number of turns that reported usage. */
  turns: number
}

/**
 * The starting total. `costUsd` is absent rather than `0`: an agent that never
 * prices a turn must not accumulate a total that reads as "this run was free"
 * (#540). It appears as soon as one turn reports a price.
 */
const ZERO: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 0,
}

/**
 * Accumulates per-turn {@link DriverUsage} into a running total for the whole
 * run and lets a budget cap gate on it (#322).
 *
 * This tracks what *this run* spent, not where the account's subscription quota
 * stands — the agent reports that separately, per turn, as `DriverRateLimit`
 * (#517). An earlier version of this note claimed the account limit was
 * unreachable under subscription auth; it isn't.
 */
export class UsageMeter {
  private totalsState: UsageTotals = { ...ZERO }

  /**
   * Fold one turn's usage into the running total. A turn that reports no price
   * still counts its tokens; it just leaves the cost total where it was, so an
   * unpriced run totals `undefined` rather than `$0` (#540).
   */
  add(usage: DriverUsage): void {
    const costUsd = usage.costUsd === undefined ? this.totalsState.costUsd : (this.totalsState.costUsd ?? 0) + usage.costUsd
    this.totalsState = {
      ...(costUsd === undefined ? {} : { costUsd }),
      inputTokens: this.totalsState.inputTokens + usage.inputTokens,
      outputTokens: this.totalsState.outputTokens + usage.outputTokens,
      cacheReadTokens: this.totalsState.cacheReadTokens + usage.cacheReadTokens,
      cacheCreationTokens: this.totalsState.cacheCreationTokens + usage.cacheCreationTokens,
      turns: this.totalsState.turns + 1,
    }
  }

  /** A snapshot of the cumulative totals. */
  totals(): UsageTotals {
    return { ...this.totalsState }
  }
}
