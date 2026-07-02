import { defineDecision, tokenize } from './define.js'
import { parseDecisions, serializeDecisions } from './markdown.js'
import type { Decision, DecisionMatch, DecisionSpec, DecisionStatus } from './types.js'

/** Options for {@link DecisionLedger.consult}. */
export interface ConsultOptions {
  /** Minimum overlap score to return a match, in `(0, 1]`. Default `0.5`. */
  threshold?: number
  /** Only match decisions with one of these statuses. Default: all. */
  status?: DecisionStatus | DecisionStatus[]
  /** Cap the number of matches returned (highest score first). */
  limit?: number
}

/**
 * An in-memory store of {@link Decision}s with the two operations the moat needs:
 * {@link record} (append a choice or rejected idea) and {@link consult} (find
 * prior decisions that a new idea resembles, so the agent does not re-pitch a
 * rejected one).
 *
 * The ledger is the canonical form; {@link toMarkdown} / {@link fromMarkdown}
 * bind it to a human-editable `DECISIONS.md`. Matching is lexical and
 * deterministic (token overlap over title + tags) — good enough to catch a
 * re-pitch and cheap enough to run before every proposal; a semantic upgrade can
 * sit behind the same {@link consult} contract later.
 */
export class DecisionLedger {
  /** Insertion-ordered by id. */
  private readonly byId = new Map<string, Decision>()

  constructor(decisions: readonly Decision[] = []) {
    for (const d of decisions) this.byId.set(d.id, d)
  }

  /**
   * Record a decision. A spec with an id that already exists replaces the prior
   * one (e.g. an idea first rejected, later accepted), keeping its original slot
   * so the ledger order is stable. Returns the frozen {@link Decision}.
   */
  record(spec: DecisionSpec): Decision {
    const decision = defineDecision(spec)
    this.byId.set(decision.id, decision)
    return decision
  }

  /** Record a rejected idea. Shorthand for `record({ ..., status: 'rejected' })`. */
  reject(title: string, rationale: string, tags?: string[]): Decision {
    return this.record({ title, rationale, status: 'rejected', ...(tags ? { tags } : {}) })
  }

  /** Record an accepted choice. Shorthand for `record({ ..., status: 'accepted' })`. */
  accept(title: string, rationale: string, tags?: string[]): Decision {
    return this.record({ title, rationale, status: 'accepted', ...(tags ? { tags } : {}) })
  }

  /** The decision with this id, or `undefined`. */
  get(id: string): Decision | undefined {
    return this.byId.get(id)
  }

  /** All decisions, in insertion order. */
  all(): Decision[] {
    return [...this.byId.values()]
  }

  /** Only the rejected decisions — the set the agent must not re-propose. */
  rejected(): Decision[] {
    return this.all().filter(d => d.status === 'rejected')
  }

  /** Number of recorded decisions. */
  get size(): number {
    return this.byId.size
  }

  /**
   * Find prior decisions that `idea` resembles. Tokenizes the idea and each
   * decision (title + tags), scores by overlap (shared tokens over the smaller
   * token set, so a short idea still matches a longer decision), and returns the
   * matches at or above `threshold`, highest score first.
   *
   * Consult before proposing: a non-empty result for a `rejected` match means
   * "you already suggested this and it was turned down".
   */
  consult(idea: string, opts: ConsultOptions = {}): DecisionMatch[] {
    const threshold = opts.threshold ?? 0.5
    const wanted = opts.status
      ? new Set(Array.isArray(opts.status) ? opts.status : [opts.status])
      : undefined
    const ideaTokens = new Set(tokenize(idea))
    if (ideaTokens.size === 0) return []

    const matches: DecisionMatch[] = []
    for (const decision of this.byId.values()) {
      if (wanted && !wanted.has(decision.status)) continue
      const decisionTokens = new Set([...tokenize(decision.title), ...decision.tags])
      if (decisionTokens.size === 0) continue

      const overlap = [...ideaTokens].filter(t => decisionTokens.has(t))
      if (overlap.length === 0) continue
      const score = overlap.length / Math.min(ideaTokens.size, decisionTokens.size)
      if (score < threshold) continue
      matches.push({ decision, score, overlap })
    }

    matches.sort((a, b) => b.score - a.score)
    return opts.limit !== undefined ? matches.slice(0, opts.limit) : matches
  }

  /**
   * True when `idea` matches a prior *rejected* decision at or above the given
   * threshold — the fast "has this already been turned down?" check.
   */
  wasRejected(idea: string, threshold?: number): boolean {
    return this.consult(idea, {
      status: 'rejected',
      ...(threshold !== undefined ? { threshold } : {}),
      limit: 1,
    }).length > 0
  }

  /** Serialize to a human-readable `DECISIONS.md`. */
  toMarkdown(): string {
    return serializeDecisions(this.all())
  }

  /** Build a ledger from `DECISIONS.md` contents. */
  static fromMarkdown(markdown: string): DecisionLedger {
    return new DecisionLedger(parseDecisions(markdown))
  }
}

/** Factory mirror of `new DecisionLedger(...)`, for a fluent call site. */
export function createLedger(decisions: readonly Decision[] = []): DecisionLedger {
  return new DecisionLedger(decisions)
}
