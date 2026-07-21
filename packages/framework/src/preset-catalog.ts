import { definePreset, type PresetDef } from './preset-prompt.js'
import {
  PRESETS_DRAIN_QUEUE,
  PRESETS_MAINTAINABILITY,
  PRESETS_MAINTENANCE,
  PRESETS_MARKET_RESEARCH,
  PRESETS_QUICK_WINS,
  PRESETS_READABILITY,
  PRESETS_RESEARCH,
  PRESETS_SECURITY_AUDIT,
  PRESETS_SPIKE_AND_PLAN,
  PRESETS_SUGGEST_NEW_TICKETS,
  PRESETS_SUGGEST_TICKETS_TO_WORK_ON,
  PRESETS_TRIAGE_CONSENSUAL,
  PRESETS_TRIAGE_QUICK,
  PRESETS_UX,
} from './prompts.generated.js'

/**
 * Every preset, in one table.
 *
 * Each of these used to be a file of its own whose whole body was one `definePreset` call (or a
 * hand-rolled equivalent) plus four alias exports — 56 exported names for 14 objects, with the
 * same four doc comments copied down the directory. What actually varies between them is two or
 * three values, which is what a row is.
 *
 * The prompt text itself is not here: it ships in `prompts/presets/<stem>.md` and reaches this
 * table through the generated constants, so a prompt is edited as prose in one place.
 *
 * Pure by construction (no `node:*`), so the dashboard can render any preset in the browser (#520).
 */
export const presets = {
  /**
   * [Research] (#331): Rom's problem-variability review, shipped as a direct prompt (see
   * `runPrompt`) rather than a build run — research reviews existing code, so it skips the
   * scope -> build scaffolding. `showMultiSelect()` + `<AWAIT>` becomes a live turn-boundary
   * gate (#339/#340) the dashboard resolves.
   */
  research: definePreset('research', PRESETS_RESEARCH, 'What to measure problem variability of'),

  /**
   * [Maintainability] (#326): deliberately minimal, so its performance can be judged before a
   * more explicit prompt is written. Keep it in sync with the issue rather than growing it here.
   */
  maintainability: definePreset('maintainability', PRESETS_MAINTAINABILITY, 'What to refactor for maintainability'),

  /** [Readability] (#326): the reader's-eye pass — seams, altitude, and one commit per refactor. */
  readability: definePreset('readability', PRESETS_READABILITY, 'What to refactor for readability'),

  /** [Security audit] (#326). */
  securityAudit: definePreset('security-audit', PRESETS_SECURITY_AUDIT, 'What to security-audit'),

  /** [UX review] (#326). */
  ux: definePreset('ux', PRESETS_UX, 'What to review the UX of'),

  /**
   * [Maintenance] (#882): the periodic codebase sweep. Note `${{ }}` fragments cannot nest (the
   * scanner stops at the first `}}`), which is why its target is a plain blank.
   */
  maintenance: definePreset('maintenance', PRESETS_MAINTENANCE, 'What to analyze for refactor opportunities'),

  // ---- Paramless: each of these scopes itself to the repo's own tickets, plans or queue, so
  // there is no blank for a user to fill.

  /**
   * [Market research] (#874). Its prompt defines `<SESSION_NAME>` itself rather than reading
   * `${{ tf.session_name }}`: the session name does not exist yet when a preset renders.
   */
  marketResearch: definePreset('market-research', PRESETS_MARKET_RESEARCH),

  /**
   * [Quick wins] (#773): harvest the cheap work out of the plans we already have. Reads the
   * `.plan.md` companions the #684 format defines and appends the quick ones to `TODO_AGENTS.md`.
   * This is the half of auto PM that closes the loop: [Spike & plan] turns tickets into plans,
   * this turns plans into queued work, and the backlog loop drains the queue.
   */
  quickWins: definePreset('quick-wins', PRESETS_QUICK_WINS),

  /** [Spike & plan] (#685): turn tickets into costed plans. */
  spikeAndPlan: definePreset('spike-and-plan', PRESETS_SPIKE_AND_PLAN),

  /** [Suggest new tickets] (#683): the dashboard prefills this one line and the user edits it freely. */
  suggestNewTickets: definePreset('suggest-new-tickets', PRESETS_SUGGEST_NEW_TICKETS),

  /**
   * [Suggest tickets to work on] (#698): the gated sibling of the triage pair. It ends in
   * `<AWAIT>`, so it is deliberately kept out of {@link AUTO_PM_JOBS} — firing it unattended
   * would wedge a run against a human who is not there.
   */
  suggestTicketsToWorkOn: definePreset('suggest-tickets-to-work-on', PRESETS_SUGGEST_TICKETS_TO_WORK_ON),

  /** [Drain queue] (#852): work the entries already on `TODO_AGENTS.md`. */
  drainQueue: definePreset('drain-queue', PRESETS_DRAIN_QUEUE),

  /**
   * [Do quick-win work] (#891) and [Do consensual work] (#892): read `tickets/*.md`, pick the ones
   * matching one filter, and append them to `TODO_AGENTS.md` — how the queue refills itself from
   * the ticket backlog. The pair splits on cost, and the split is the point: both are consensual
   * (zero open questions, zero variability), so neither needs a human, and they differ only in
   * whether the work is cheap. Keeping them apart lets the rotation queue the cheap batch and the
   * significant batch on separate turns rather than in one indiscriminate sweep.
   *
   * Each prompt pins its own `<SESSION_NAME>` and aborts when `the-framework/<SESSION_NAME>`
   * already exists. That collision guard is what makes them safe to fire on a schedule: a triage
   * still in flight owns the branch, so the next firing does nothing instead of triaging twice.
   */
  triageQuick: definePreset('triage-quick', PRESETS_TRIAGE_QUICK),
  triageConsensual: definePreset('triage-consensual', PRESETS_TRIAGE_CONSENSUAL),
} as const satisfies Record<string, PresetDef>

/** The presets by key, e.g. `quickWins`. */
export type PresetKey = keyof typeof presets
