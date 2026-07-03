import type { BootstrapEvent } from '@gemstack/ai-autopilot'
import type { DriverEvent } from './driver/index.js'

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
  /** A framework-level log line. */
  | { kind: 'log'; message: string }
  /** The run finished. `ok` is false when it threw. */
  | { kind: 'end'; ok: boolean; detail?: string }

/** Render a {@link FrameworkEvent} as one human-readable line (terminal surface). */
export function formatFrameworkEvent(event: FrameworkEvent): string {
  switch (event.kind) {
    case 'session':
      return `◆ ${event.fake ? 'fake' : event.driver} in ${event.workspace}${
        event.sessionLink ? ` — ${event.sessionLink}` : ''
      }`
    case 'session-update':
      return `  session ${event.sessionId}${event.sessionLink ? ` — ${event.sessionLink}` : ''}`
    case 'log':
      return `  ${event.message}`
    case 'driver':
      return formatDriverEvent(event.event)
    case 'bootstrap':
      return formatBootstrapEvent(event.event)
    case 'end':
      return event.ok ? '✓ done' : `✗ failed: ${event.detail ?? 'unknown error'}`
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
