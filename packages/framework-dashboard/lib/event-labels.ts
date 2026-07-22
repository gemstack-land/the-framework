import type { FrameworkEvent } from '@gemstack/framework'

type EventKind = FrameworkEvent['kind']

// The badge next to each session-log line should read plainly to someone seeing the UI for the
// first time (#1035). Only the kinds whose raw name is internal jargon get a friendly word; every
// other kind falls back to its name with hyphens turned to spaces (`system-prompt` -> "system
// prompt"). The badge is CSS-uppercased, so the values here stay lowercase.
const OVERRIDES: Partial<Record<EventKind, string>> = {
  driver: 'agent', // the AI turn: prompt sent, reply, turn complete
  settled: 'waiting', // done for now, waiting for your next message
  usage: 'cost', // spend so far
  'session-update': 'resume', // the resumable session id + link
}

/** The plain-language badge label for a session-log event kind. */
export function eventKindLabel(kind: EventKind): string {
  return OVERRIDES[kind] ?? kind.replace(/-/g, ' ')
}
