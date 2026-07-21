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
   * [Research] (#331): the problem-variability review, shipped as a direct prompt (see
   * `runPrompt`) rather than a build run — research reviews existing code, so it skips the
   * scope -> build scaffolding. `showMultiSelect()` + `<AWAIT>` becomes a live turn-boundary
   * gate (#339/#340) the dashboard resolves.
   */
  research: definePreset({ name: 'research', template: PRESETS_RESEARCH, what: 'What to measure problem variability of', label: 'Research' }),

  /**
   * [Maintainability] (#361): deliberately minimal, so its performance can be judged before a
   * more explicit prompt is written. Keep it in sync with the issue rather than growing it here.
   */
  maintainability: definePreset({ name: 'maintainability', template: PRESETS_MAINTAINABILITY, what: 'What to refactor for maintainability', label: 'Maintainability' }),

  /** [Readability] (#360): the reader's-eye pass — seams, altitude, and one commit per refactor. */
  readability: definePreset({ name: 'readability', template: PRESETS_READABILITY, what: 'What to refactor for readability', label: 'Readability' }),

  /** [Security audit] (#461). */
  securityAudit: definePreset({ name: 'security-audit', template: PRESETS_SECURITY_AUDIT, what: 'What to security-audit', label: 'Security audit' }),

  /**
   * [UX (auto)] (#962, replacing #472's gated prompt): rate every UI flow, then fix the low
   * scorers. Unattended by design — it ends in work rather than in `<AWAIT>`, so a run started
   * from it finishes on its own. A gated sibling that offers its ratings as choices is #962's
   * stated follow-up and belongs beside this row, not inside it.
   */
  ux: definePreset({ name: 'ux', template: PRESETS_UX, what: 'What to review the UX of', label: 'UX (auto)' }),

  /**
   * [Maintenance] (#881/#882): the periodic codebase sweep. Note `${{ }}` fragments cannot nest (the
   * scanner stops at the first `}}`), which is why its target is a plain blank.
   */
  maintenance: definePreset({ name: 'maintenance', template: PRESETS_MAINTENANCE, what: 'What to analyze for refactor opportunities', label: 'Maintenance', tooltip: 'Queue maintainability + security work per codebase subset (TODO_AGENTS.md)' }),

  // ---- Paramless: each of these scopes itself to the repo's own tickets, plans or queue, so
  // there is no blank for a user to fill.

  /**
   * [Market research] (#694). Its prompt defines `<SESSION_NAME>` itself rather than reading
   * `${{ tf.session_name }}`: it is launched from the launcher, where no session exists yet.
   */
  marketResearch: definePreset({ name: 'market-research', template: PRESETS_MARKET_RESEARCH, label: 'Market research' }),

  /**
   * [Quick wins] (#773): harvest the cheap work out of the plans we already have. Reads the
   * `.plan.md` companions the #684 format defines and appends the quick ones to `TODO_AGENTS.md`.
   * This is the half of auto PM that closes the loop: [Spike & plan] turns tickets into plans,
   * this turns plans into queued work, and the backlog loop drains the queue.
   */
  quickWins: definePreset({ name: 'quick-wins', template: PRESETS_QUICK_WINS, label: 'Quick wins' }),

  /** [Spike & plan] (#685): turn tickets into costed plans. */
  spikeAndPlan: definePreset({ name: 'spike-and-plan', template: PRESETS_SPIKE_AND_PLAN, label: 'Spike & plan' }),

  /** [Suggest new tickets] (#462/#683): the dashboard prefills this one line and the user edits it freely. */
  suggestNewTickets: definePreset({ name: 'suggest-new-tickets', template: PRESETS_SUGGEST_NEW_TICKETS, label: 'Suggest new tickets' }),

  /**
   * [Suggest tickets to work on] (#698): the gated sibling of the triage pair. It ends in
   * `<AWAIT>`, so it is deliberately kept out of {@link AUTO_PM_JOBS} — firing it unattended
   * would wedge a run against a human who is not there.
   */
  suggestTicketsToWorkOn: definePreset({ name: 'suggest-tickets-to-work-on', template: PRESETS_SUGGEST_TICKETS_TO_WORK_ON, label: 'Suggest tickets to work on', tooltip: 'Add tickets to queue (TODO_AGENTS.md)' }),

  /** [Drain queue] (#855): work the entries already on `TODO_AGENTS.md`. */
  drainQueue: definePreset({ name: 'drain-queue', template: PRESETS_DRAIN_QUEUE, label: 'Drain queue' }),

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
  triageQuick: definePreset({ name: 'triage-quick', template: PRESETS_TRIAGE_QUICK, label: 'Do quick-win work', tooltip: 'Add `tickets/*.md` to queue (TODO_AGENTS.md), only quick-win and consensual tickets' }),
  triageConsensual: definePreset({ name: 'triage-consensual', template: PRESETS_TRIAGE_CONSENSUAL, label: 'Do consensual work', tooltip: 'Add `tickets/*.md` to queue (TODO_AGENTS.md), only significant (no quick-wins) and consensual tickets' }),
} as const satisfies Record<string, PresetDef>

/** The presets by key, e.g. `quickWins`. */
export type PresetKey = keyof typeof presets

/**
 * The presets the launcher offers, in the order it shows them.
 *
 * One list rather than a `launcher: true` flag on each row: membership and order are the same
 * decision, and a flag would have stated half of it while the order lived somewhere else. It is
 * also the answer to "which presets are user-facing" — `drainQueue` is absent because only the
 * daemon fires it, which previously had nothing marking it internal.
 */
export const LAUNCHER_PRESETS: readonly PresetDef[] = [
  presets.research,
  presets.readability,
  presets.maintainability,
  presets.securityAudit,
  presets.ux,
  presets.suggestNewTickets,
  presets.suggestTicketsToWorkOn,
  presets.spikeAndPlan,
  presets.quickWins,
  presets.marketResearch,
  presets.maintenance,
  presets.triageQuick,
  presets.triageConsensual,
]
