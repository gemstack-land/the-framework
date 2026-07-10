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

const ZERO: UsageTotals = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 0,
}

/**
 * Accumulates per-turn {@link DriverUsage} into a running total for the whole
 * run. The framework can't retrieve the account's usage *limit* under
 * subscription auth, so it infers consumption from what the agent already
 * reports each turn (the alternative from #322) and lets a budget cap gate on it.
 */
export class UsageMeter {
  private totalsState: UsageTotals = { ...ZERO }

  /** Fold one turn's usage into the running total. */
  add(usage: DriverUsage): void {
    this.totalsState = {
      costUsd: this.totalsState.costUsd + usage.costUsd,
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
