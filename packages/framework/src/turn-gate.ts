import type { ChoicesOption } from './run.js'

/**
 * The framework-owned "await" protocol (#337): the *code side* of the #326
 * `showChoices()` / `AWAIT` macros that Rom delegated. The driver runs each agent
 * turn as a black box to completion (#165), so the only way the framework can learn
 * the agent stopped to ask (rather than deciding for itself) is a signal in the
 * turn's final message. This appends one to the system prompt: it does not restate
 * the macros, it pins *how* to emit an awaited choice so the turn-boundary gate can
 * detect it. Kept minimal and self-contained so it survives the #326 wording still
 * being written.
 */
export const AWAIT_PROTOCOL = [
  '## Awaiting a choice',
  'When these instructions tell you to showChoices() and then AWAIT, do not pick for the user.',
  'End your turn with a fenced code block tagged `await-choices` holding JSON, then stop:',
  '```await-choices',
  '{ "title": "<the question>", "options": [{ "label": "<option>", "detail": "<optional one-liner>" }], "recommended": "<the label to default to>" }',
  '```',
  'The framework shows the choice, waits for the user, and re-prompts you with their pick. Do not continue past it on your own.',
].join('\n')

/** A choice an agent stopped to ask, parsed from an `await-choices` block (#337). */
export interface ParsedChoicesGate {
  /** The question shown above the options. */
  title: string
  /** The options to choose between (at least one). */
  options: ChoicesOption[]
  /** The option id to default to, when the agent named one. */
  recommended?: string
}

/** Matches every `await-choices` fenced block; the last one in the turn wins. */
const AWAIT_CHOICES_BLOCK = /```await-choices\s+([\s\S]*?)```/g

/**
 * Parse a trailing `await-choices` block (per {@link AWAIT_PROTOCOL}) from a turn's
 * final text (#337). Returns `undefined` when the agent did not stop to ask, which is
 * the common case, so a normal build turn flows straight through. Tolerant by design:
 * ids are synthesized from position, a blank title falls back, `recommended` may be
 * given as a label or an id, and a malformed block is ignored (no gate) rather than
 * throwing — a bad parse must never crash a build.
 */
export function parseChoicesGate(text: string): ParsedChoicesGate | undefined {
  let body: string | undefined
  for (const match of text.matchAll(AWAIT_CHOICES_BLOCK)) body = match[1]
  if (body === undefined) return undefined

  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.options)) return undefined

  const options: ChoicesOption[] = []
  record.options.forEach((entry, i) => {
    const o = entry as Record<string, unknown> | null
    const label = typeof o?.label === 'string' ? o.label.trim() : ''
    if (!label) return
    const rawId = typeof o?.id === 'string' ? o.id.trim() : ''
    const detail = typeof o?.detail === 'string' ? o.detail.trim() : ''
    options.push({ id: rawId || `opt:${i}`, label, ...(detail ? { detail } : {}) })
  })
  if (options.length === 0) return undefined

  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Which option?'
  const rec = typeof record.recommended === 'string' ? record.recommended.trim() : ''
  const recommended = rec ? (options.find(o => o.id === rec) ?? options.find(o => o.label === rec))?.id : undefined

  return { title, options, ...(recommended ? { recommended } : {}) }
}
