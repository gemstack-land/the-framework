/**
 * The decisions ledger — a durable record of the choices and rejected ideas of
 * a project, so an autopilot run stops re-pitching what was already turned down.
 *
 * A {@link Decision} is *data*: a settled choice or a rejected idea with the
 * reason behind it. The ledger is the canonical store; it round-trips to a
 * human-readable `DECISIONS.md` the user can also read and edit. Before an agent
 * proposes something it consults the ledger; when a suggestion is accepted or
 * rejected it appends to it. This is the "declare intent once, respect it" seam.
 */

/**
 * The standing of a recorded decision.
 *
 * - `rejected` — an idea that was considered and turned down; the agent must not
 *   re-propose it. The primary reason the ledger exists.
 * - `accepted` — a settled choice the project has committed to.
 * - `superseded` — a past decision replaced by a later one (see
 *   {@link Decision.supersededBy}); kept for history, not enforced.
 */
export type DecisionStatus = 'rejected' | 'accepted' | 'superseded'

/** A single recorded decision or rejected idea. Frozen once defined. */
export interface Decision {
  /** Stable slug, kebab-case; derived from {@link title} when not supplied. */
  readonly id: string
  /** One-line statement of the idea or choice (e.g. "Use Redux for state"). */
  readonly title: string
  /** Whether the idea was rejected, accepted, or later superseded. */
  readonly status: DecisionStatus
  /** The "because Y": why it was rejected or chosen. */
  readonly rationale: string
  /** Free-form topic tags used to match related ideas (lowercased). */
  readonly tags: readonly string[]
  /** ISO date the decision was recorded, when known. */
  readonly date?: string
  /** For `superseded` decisions, the id of the decision that replaced it. */
  readonly supersededBy?: string
}

/**
 * The author-facing shape passed to {@link defineDecision} / `ledger.record`.
 * Optional fields default: `status` to `rejected`, `tags` to empty, `id` to a
 * slug of the title.
 */
export interface DecisionSpec {
  title: string
  rationale: string
  status?: DecisionStatus
  id?: string
  tags?: string[]
  date?: string
  supersededBy?: string
}

/** A prior decision surfaced by {@link DecisionLedger.consult} for a new idea. */
export interface DecisionMatch {
  /** The matching prior decision. */
  decision: Decision
  /** Overlap score in `(0, 1]`; higher means a closer match. */
  score: number
  /** The terms the idea and the decision share, for an explainable match. */
  overlap: readonly string[]
}
