// The `--session-link` plumbing: turn a link template into a real URL for the wrapped
// agent's session. Kept apart from the event contract (events.ts) and the terminal
// formatter (terminal.ts) — it is about session URLs, not event shapes or rendering.

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
