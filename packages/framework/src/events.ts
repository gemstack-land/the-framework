import type { BootstrapEvent } from '@gemstack/ai-autopilot'
import type { DriverEvent } from './driver/index.js'

/** One selectable option in an interactive {@link ChoiceRequest} (#304). */
export interface ChoiceOption {
  /** Stable id posted back when this option is picked. */
  id: string
  /** The option shown to the user. */
  label: string
  /** Optional one-line detail under the label (e.g. why an alternative lost). */
  detail?: string
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
  /** The option id pre-selected as the default (autopilot auto-accepts it). */
  recommended: string
  /** Auto-accept the recommended option after this many ms when autopilot is on. Default 10000. */
  autoAcceptMs?: number
}

/** Who resolved a {@link ChoiceRequest}: a human, the autopilot countdown, or a headless auto-accept. */
export type ChoiceBy = 'user' | 'autopilot' | 'auto'

/** What a {@link import('./run.js').RunFrameworkOptions.requestChoice} handler resolves with. */
export interface ChoicePick {
  /** The picked option id. */
  picked: string
  /** Who picked it. Default `'user'`. */
  by?: ChoiceBy
}

/**
 * The single event type the whole run streams over. It unifies three sources so
 * the dashboard (and terminal) render one timeline: bootstrap-phase narration
 * (the moat: architect rationale, checklist verdicts, deploy), the wrapped
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
  /** A bootstrap-phase narration event (scope / architect / checklist / deploy / ...). */
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
  /** A pending {@link ChoiceRequest} was resolved — the run continues on `picked`. */
  | { kind: 'choice-resolved'; id: string; picked: string; by: ChoiceBy }
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
    case 'preview':
      return `▶ your app is running at ${event.url}`
    case 'log':
      return `  ${event.message}`
    case 'modes': {
      const shown = event.all.map(m => `${event.active.includes(m) ? '[x]' : '[ ]'} ${m}`).join('  ')
      return `  modes: ${shown}`
    }
    case 'choice': {
      const opts = event.options
        .map(o => `    ${o.id === event.recommended ? '●' : '○'} ${o.label}`)
        .join('\n')
      return `? ${event.title}\n${opts}`
    }
    case 'choice-resolved':
      return `  ✓ chose ${event.picked} (${event.by})`
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
      return `  › prompt sent`
    case 'text':
      return `    ${truncate(event.text)}`
    case 'action':
      return `    · ${event.label}`
    case 'result':
      return `  ‹ turn complete`
    case 'error':
      return `  ! agent error: ${event.message}`
  }
}

function formatBootstrapEvent(event: BootstrapEvent): string {
  switch (event.type) {
    case 'scope':
      return `▶ scope: ${event.scope} — "${event.intent}"`
    case 'architect':
      return `▶ architect: ${event.stack}\n${event.decisions.map(d => `    · ${d.choice} — ${d.why}`).join('\n')}`
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
 * The single source of truth for both the mode checkboxes (#272) and the
 * meta-select router's validation ({@link import('./meta-select.js').META_SELECT_MODES}).
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
