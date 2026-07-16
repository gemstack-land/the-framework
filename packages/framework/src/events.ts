import type { BootstrapEvent } from '@gemstack/ai-autopilot'
import type { DriverEvent, DriverRateLimit } from './driver/index.js'

/** One selectable option in an interactive {@link ChoiceRequest} (#304). */
export interface ChoiceOption {
  /** Stable id posted back when this option is picked. */
  id: string
  /** The option shown to the user. */
  label: string
  /** Optional one-line detail under the label (e.g. why an alternative lost). */
  detail?: string
  /** In a multi-select ({@link ChoiceRequest.multi}), whether this option starts checked. Ignored for single-select. */
  default?: boolean
}

/**
 * An interactive choice the run pauses on until a pick arrives (#304). Emitted as
 * a `choice` {@link FrameworkEvent}; the dashboard renders it in a panel and posts
 * the pick back. The recommended option is the default the autopilot auto-accepts.
 */
export interface ChoiceRequest {
  /** Unique id for this pending choice; the pick is posted back against it. */
  id: string
  /** The question shown above the options (e.g. "Approve this plan?"). */
  title: string
  /** The options to choose between (at least one). */
  options: readonly ChoiceOption[]
  /**
   * The option id pre-selected as the default (autopilot auto-accepts it). Required
   * for a single-select; omitted for a {@link multi} select, where each option's own
   * {@link ChoiceOption.default} drives the pre-checked set instead.
   */
  recommended?: string
  /**
   * Render as a multi-select checklist (#332): each option is a checkbox pre-checked
   * per its {@link ChoiceOption.default}, and the pick resolves to the selected
   * *subset* of ids rather than one. Absent = the single-select gate (#304).
   */
  multi?: boolean
  /** Auto-accept the recommended option after this many ms when autopilot is on. Default 10000. */
  autoAcceptMs?: number
  /**
   * Render as an Approve/Decline confirmation (#358): the dashboard shows a green
   * Approve and a red Decline button instead of the option list. The options still
   * carry the two ids, so the pick machinery is unchanged.
   */
  confirm?: boolean
  /** The markdown file under approval (e.g. `PLAN_<slug>.agent.md`); the doc sidebar renders it. */
  file?: string
}

/** Who resolved a {@link ChoiceRequest}: a human, the autopilot countdown, or a headless auto-accept. */
export type ChoiceBy = 'user' | 'autopilot' | 'auto'

/** What a {@link import('./run.js').RunFrameworkOptions.requestChoice} handler resolves with. */
export interface ChoicePick {
  /** The picked option id, or (for a {@link ChoiceRequest.multi} select) the selected subset of ids. */
  picked: string | readonly string[]
  /** Who picked it. Default `'user'`. */
  by?: ChoiceBy
}

/** Normalize a {@link ChoicePick} (single id or subset) to a list of picked ids. */
export function pickedIds(picked: string | readonly string[]): string[] {
  return Array.isArray(picked) ? [...picked] : picked ? [picked as string] : []
}

/**
 * The single event type the whole run streams over. It unifies three sources so
 * the dashboard (and terminal) render one timeline: bootstrap-phase narration
 * (the moat: checklist verdicts, deploy), the wrapped
 * agent's own black-box progress, and framework-level status. We own this stream
 * (guardrail #2, #165) rather than surfacing the agent's transport directly.
 */
export type FrameworkEvent =
  /** Emitted once at start: which agent is wrapped, the workspace, and a link. */
  | { kind: 'session'; driver: string; workspace: string; fake: boolean; sessionLink?: string }
  /**
   * Emitted once the wrapped agent reports its real session id (not known at
   * start). Carries the live id and, when a link template was supplied, the
   * resolved URL to jump into that session (#165). Re-emitted if the id changes
   * (each Claude Code prompt is a fresh session), keeping the link current.
   */
  | { kind: 'session-update'; sessionId: string; sessionLink?: string }
  /**
   * The full system prompt sent to the wrapped agent for this run (#343): the
   * #326 block plus any personas / skills / memory framing, exactly as passed to
   * the driver's system channel. Emitted once at session start so the dashboard
   * can show the normally-hidden prompt (the per-turn user prompts arrive as
   * `driver` `start` events, which already carry their text). Transparency, never
   * gated on.
   */
  | { kind: 'system-prompt'; text: string }
  /** A bootstrap-phase narration event (scope / checklist / deploy / ...). */
  | { kind: 'bootstrap'; event: BootstrapEvent }
  /** The wrapped agent's own progress, forwarded verbatim (never gated on). */
  | { kind: 'driver'; event: DriverEvent }
  /**
   * The generated app is booted and serving. Emitted after a successful run when
   * a serve config is set: the app is kept running so the user can open it, and
   * the dashboard shows a live preview link (torn down on Ctrl+C).
   */
  | { kind: 'preview'; url: string; command: string }
  /** A framework-level log line. */
  | { kind: 'log'; message: string }
  /**
   * An ad-hoc markdown view the agent pushed to show the user (#441), e.g. a plan,
   * a summary, or a diff writeup. Non-blocking (unlike a `choice`): the dashboard
   * renders it as a view in the right rail. `id` is stable per title, so re-showing
   * the same view updates it in place rather than stacking a duplicate.
   */
  | { kind: 'view'; id: string; title: string; markdown: string }
  /**
   * The agent named the session (#326): the `[a-z0-9-]` slug it chose (also its
   * `the-framework/<name>` branch), from a `setSessionName()` signal. Non-blocking;
   * the dashboard shows it as the run's label. Re-emitted on a rename.
   */
  | { kind: 'session-name'; name: string }
  /**
   * The agent signalled `setReadyForMerge()` (#326): it believes the work is complete
   * and ready for human review. Non-blocking — it flips the run's dashboard status from
   * building (orange) to ready (green); the on-before-mergeable quality prompts hang off it.
   */
  | { kind: 'ready-for-merge' }
  /**
   * Cumulative token + cost usage for the run so far (#322). Emitted after each
   * agent turn that reports usage; the dashboard renders a live spend readout and
   * the run stops itself once `costUsd` reaches the budget cap, if one is set.
   *
   * `costUsd` is absent when the agent reports tokens but no price (#540), which
   * is also when no budget cap can fire.
   */
  | {
      kind: 'usage'
      costUsd?: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      turns: number
      /** The budget cap in USD this run is gated on, when one was set. */
      budgetUsd?: number
    }
  /**
   * The run's active Open Loop modes (#272), emitted once when a domain preset is
   * in effect. `all` is every mode the run knows about (stable order); `active` is
   * the subset switched on for this run. The dashboard renders them as read-only
   * checkboxes so the policy driving the build is visible.
   */
  | { kind: 'modes'; all: readonly string[]; active: readonly string[] }
  /**
   * The run paused on an interactive choice (#304) and is awaiting a pick. The
   * dashboard renders the options with the recommended default pre-selected and
   * posts the pick back; a headless run auto-accepts the recommended option.
   */
  | ({ kind: 'choice' } & ChoiceRequest)
  /** A pending {@link ChoiceRequest} was resolved — the run continues on `picked` (one id, or the selected subset). */
  | { kind: 'choice-resolved'; id: string; picked: string | readonly string[]; by: ChoiceBy }
  /**
   * The run finished. `ok` is false when it threw. `stopped` marks the common,
   * non-error case where the user interrupted it (the dashboard Stop button /
   * Ctrl+C), so a surface can show "stopped" rather than "failed".
   */
  | { kind: 'end'; ok: boolean; stopped?: boolean; detail?: string }

/** Render a {@link FrameworkEvent} as one human-readable line (terminal surface). */
export function formatFrameworkEvent(event: FrameworkEvent): string {
  switch (event.kind) {
    case 'session':
      return `◆ ${event.fake ? 'fake' : event.driver} in ${event.workspace}${
        event.sessionLink ? ` — ${event.sessionLink}` : ''
      }`
    case 'session-update':
      return `  session ${event.sessionId}${event.sessionLink ? ` — ${event.sessionLink}` : ''}`
    case 'system-prompt':
      return `  system prompt sent (${event.text.length} chars)`
    case 'preview':
      return `▶ your app is running at ${event.url}`
    case 'log':
      return `  ${event.message}`
    case 'view':
      return `▶ view: ${event.title}`
    case 'session-name':
      return `  session: ${event.name}`
    case 'ready-for-merge':
      return `✓ ready for merge`
    case 'usage': {
      const turns = `over ${event.turns} turn${event.turns === 1 ? '' : 's'}`
      // No price to show: report the tokens the agent *did* report, rather than a
      // `$0.0000` that would read as free (#540).
      if (event.costUsd === undefined) {
        const tokens = event.inputTokens + event.cacheReadTokens + event.outputTokens
        return `  tokens: ${tokens.toLocaleString('en-US')} (${event.outputTokens.toLocaleString('en-US')} out) ${turns} — no price reported`
      }
      return `  spend: $${event.costUsd.toFixed(4)}${event.budgetUsd ? ` / $${event.budgetUsd}` : ''} ${turns}`
    }
    case 'modes': {
      const shown = event.all.map(m => `${event.active.includes(m) ? '[x]' : '[ ]'} ${m}`).join('  ')
      return `  modes: ${shown}`
    }
    case 'choice': {
      const mark = (o: ChoiceOption) =>
        event.multi ? (o.default ? '[x]' : '[ ]') : o.id === event.recommended ? '●' : '○'
      const opts = event.options.map(o => `    ${mark(o)} ${o.label}`).join('\n')
      return `? ${event.title}\n${opts}`
    }
    case 'choice-resolved':
      return `  ✓ chose ${pickedIds(event.picked).join(', ') || '(none)'} (${event.by})`
    case 'driver':
      return formatDriverEvent(event.event)
    case 'bootstrap':
      return formatBootstrapEvent(event.event)
    case 'end':
      return event.ok ? '✓ finished' : event.stopped ? '■ stopped' : `✗ failed: ${event.detail ?? 'unknown error'}`
  }
}

function formatDriverEvent(event: DriverEvent): string {
  switch (event.type) {
    case 'start':
      return `  › prompt: ${truncate(event.prompt, 140)}`
    case 'text':
      return `    ${truncate(event.text)}`
    case 'action':
      return `    · ${event.label}`
    case 'result':
      return `  ‹ turn complete`
    case 'rate-limit':
      return `    ${formatRateLimit(event.limit)}`
    case 'error':
      return `  ! agent error: ${event.message}`
  }
}

/** Quiet on the happy path: only worth a line when the quota is actually tight. */
function formatRateLimit(limit: DriverRateLimit): string {
  const resets = new Date(limit.resetsAt).toISOString()
  if (limit.status === 'rejected') return `✗ quota exhausted (${limit.window}), resets ${resets}`
  if (limit.status === 'allowed_warning') return `! quota running low (${limit.window}), resets ${resets}`
  return `· quota ${limit.status} (${limit.window}), resets ${resets}`
}

function formatBootstrapEvent(event: BootstrapEvent): string {
  switch (event.type) {
    case 'scope':
      return `▶ scope: ${event.scope} — "${event.intent}"`
    case 'narrate':
      return `  ${event.message}`
    case 'build':
      return `    build/${event.event.type}`
    case 'checklist':
      return event.passing
        ? `  ✓ checklist pass ${event.pass}: production-grade`
        : `  ✗ checklist pass ${event.pass}: ${event.blockers.join('; ')}`
    case 'improve':
      return `  → improving: ${event.blockers.join('; ')}`
    case 'deploy':
      return `▶ deploy: ${event.plan.render.toUpperCase()} → ${event.plan.target} (${event.plan.reason})`
    case 'done':
      return `✓ ${event.result.productionGrade ? 'production-grade' : 'prototype'} in ${event.result.passes} pass(es)`
  }
}

function truncate(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/**
 * The Open Loop modes a run can activate, in the order the dashboard shows them.
 * The single source of truth for the mode checkboxes (#272).
 */
export const OPEN_LOOP_MODES = ['autopilot', 'technical'] as const

/**
 * The placeholder a `--session-link` template uses for the real session id.
 * Remote Control does not expose a URL you can build from a session id, so we
 * surface the honest id and let a template drop a real URL in when there is one:
 * `--session-link "https://example.com/s/{sessionId}"`.
 */
export const SESSION_ID_PLACEHOLDER = '{sessionId}'

/** Whether a `--session-link` value is a template (needs the id) vs a literal URL. */
export function hasSessionIdPlaceholder(template: string): boolean {
  return template.includes(SESSION_ID_PLACEHOLDER)
}

/** Fill a `--session-link` template with the real session id (no-op for a literal). */
export function resolveSessionLink(template: string, sessionId: string): string {
  return template.split(SESSION_ID_PLACEHOLDER).join(sessionId)
}

/**
 * The generic Claude Code entry point. It is NOT a per-run live session: a
 * headless run is not Remote-Controlled, so there is no deep link to build (see
 * #214). We surface this only as an "Open Claude Code" affordance; a real live
 * link comes from an explicit `--session-link`.
 */
export const CLAUDE_CODE_SESSION_LINK = 'https://claude.ai/code'
