import { PROTOCOLS_AWAIT, PROTOCOLS_SIGNAL } from './prompts.generated.js'
import type { ChoicesOption } from './run.js'
import type { MultiSelectOption } from './run.js'

/**
 * The framework-owned "await" protocol (#337 / #339): the *code side* of the
 * `showChoices()` / `showMultiSelect()` + `AWAIT` macros that Rom delegated. The
 * driver runs each agent turn as a black box to completion (#165), so the only way
 * the framework can learn the agent stopped to ask (rather than deciding for itself)
 * is a signal in the turn's final message. This appends one to the system prompt: it
 * does not restate the macros, it pins *how* to emit an awaited choice so the
 * turn-boundary gate can detect it. Kept minimal and self-contained so it survives the
 * #326 wording still being written. The text lives in `prompts/protocols/await.md` (#551).
 */
export const AWAIT_PROTOCOL = PROTOCOLS_AWAIT

/**
 * The session-lifecycle protocol (#326): the code side of the `setSessionName()` and
 * `setReadyForMerge()` actions Rom's system prompt calls out. Like {@link AWAIT_PROTOCOL},
 * it does not restate *when* to act — the system prompt owns that — it only pins *how* to
 * emit the signal so the turn-boundary can detect it. Both are non-blocking: the agent
 * emits the block and keeps going (the framework records it and reflects it in the
 * dashboard). Injected alongside AWAIT_PROTOCOL. The text lives in
 * `prompts/protocols/signal.md` (#551).
 */
export const SIGNAL_PROTOCOL = PROTOCOLS_SIGNAL

/** A single-select choice an agent stopped to ask, parsed from an `await-choices` block (#337). */
export interface ParsedChoicesGate {
  /** The question shown above the options. */
  title: string
  /** The options to choose between (at least one). */
  options: ChoicesOption[]
  /** The option id to default to, when the agent named one. */
  recommended?: string
}

/** A multi-select an agent stopped to ask, parsed from an `await-multiselect` block (#339). */
export interface ParsedMultiSelectGate {
  /** The prompt shown above the checklist. */
  title: string
  /** The options (each may start checked via {@link MultiSelectOption.default}). */
  options: MultiSelectOption[]
}

/** A plan/document approval an agent stopped to ask, parsed from an `await-confirmation` block (#358). */
export interface ParsedConfirmationGate {
  /** The question shown above the Approve / Decline buttons. */
  title: string
  /** The markdown file under approval (the doc sidebar renders it), when the agent named one. */
  file?: string
}

/** A parsed await gate: any kind, discriminated by `kind`. */
export type ParsedAwaitGate =
  | ({ kind: 'choices' } & ParsedChoicesGate)
  | ({ kind: 'multi' } & ParsedMultiSelectGate)
  | ({ kind: 'confirm' } & ParsedConfirmationGate)

/** The answer a resolved confirmation gate (#358) yields: the picked button's label. */
export const CONFIRM_APPROVED = 'Approve'
export const CONFIRM_DECLINED = 'Decline'

/** The log line printed when a confirmation gate is declined (#358). */
export const PLAN_DECLINED_MESSAGE = 'Plan declined, awaiting user instructions.'

/** Whether a resolved gate was a declined confirmation (#358): the caller stops instead of re-prompting. */
export function isDeclinedConfirmation(gate: ParsedAwaitGate, answer: string): boolean {
  return gate.kind === 'confirm' && answer === CONFIRM_DECLINED
}

/** A non-blocking markdown view the agent pushed via a `show-markdown` block (#441). */
export interface ParsedMarkdownView {
  /** Stable id (a slug of the title), so re-showing the same title updates in place. */
  id: string
  /** The view's title (the first `# ` heading, or a fallback). */
  title: string
  /** The markdown body (the heading line removed). */
  markdown: string
}

/** Slugify a title into a stable id, or `view` when it has no usable characters. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'view'
}

/**
 * Parse every `show-markdown` block (per {@link AWAIT_PROTOCOL}) out of a turn's text
 * (#441) — a non-blocking view the agent pushed to the side panel, so a turn may carry
 * several and does not stop. Each block's first `# ` line is the title (the rest is the
 * body); a block with no heading falls back to "Note". Blank blocks are skipped, and two
 * blocks that slug to the same id keep the later one (an in-turn update). Never throws.
 */
export function parseMarkdownViews(text: string): ParsedMarkdownView[] {
  const re = /```show-markdown\s+([\s\S]*?)```/g
  const byId = new Map<string, ParsedMarkdownView>()
  for (const m of text.matchAll(re)) {
    const body = (m[1] ?? '').trim()
    if (!body) continue
    const lines = body.split('\n')
    const heading = /^#\s+(.+)/.exec(lines[0] ?? '')
    const title = heading ? heading[1]!.trim() : 'Note'
    const markdown = (heading ? lines.slice(1).join('\n') : body).trim()
    if (!markdown) continue
    const id = slugify(title)
    byId.set(id, { id, title, markdown })
  }
  return [...byId.values()]
}

/**
 * Parse the session name the agent set this turn (#326), from the last `set-session-name`
 * block (per {@link SIGNAL_PROTOCOL}) — its first non-empty line, slugified to `[a-z0-9-]`
 * so it matches the branch-name shape. Returns `undefined` when the agent did not set one
 * (the common case) or the block is blank. A later block in the same turn wins (a rename).
 */
export function parseSessionName(text: string): string | undefined {
  const re = /```set-session-name\s+([\s\S]*?)```/g
  let name: string | undefined
  for (const m of text.matchAll(re)) {
    const line = (m[1] ?? '').split('\n').map(l => l.trim()).find(Boolean)
    const slug = line ? slugify(line) : ''
    if (slug && slug !== 'view') name = slug
  }
  return name
}

/**
 * Whether the agent signalled `setReadyForMerge()` this turn (#326): the presence of a
 * `ready-for-merge` block (per {@link SIGNAL_PROTOCOL}) anywhere in the text. Non-blocking
 * and body-less — it just flips the run from building to ready-for-review.
 */
export function parseReadyForMerge(text: string): boolean {
  return /```ready-for-merge\s*```/.test(text) || /```ready-for-merge\s+[\s\S]*?```/.test(text)
}

/** Find the body + start index of the last fenced block with `tag` in `text`. */
function lastBlock(text: string, tag: string): { body: string; index: number } | undefined {
  const re = new RegExp('```' + tag + '\\s+([\\s\\S]*?)```', 'g')
  let found: { body: string; index: number } | undefined
  for (const m of text.matchAll(re)) found = { body: m[1] ?? '', index: m.index ?? 0 }
  return found
}

/** Parse the JSON body of an await block, returning its `options` array or undefined. */
function parseBody(body: string): { record: Record<string, unknown>; options: Record<string, unknown>[] } | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.options)) return undefined
  return { record, options: record.options as Record<string, unknown>[] }
}

/** Read a trimmed string field, or `''`. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Parse a trailing `await-choices` block (per {@link AWAIT_PROTOCOL}) from a turn's
 * final text (#337). Returns `undefined` when the agent did not stop to ask (the common
 * case). Tolerant by design: ids are synthesized from position, a blank title falls
 * back, `recommended` may be a label or an id, and a malformed block is ignored rather
 * than throwing — a bad parse must never crash a build.
 */
export function parseChoicesGate(text: string): ParsedChoicesGate | undefined {
  const block = lastBlock(text, 'await-choices')
  if (!block) return undefined
  const parsed = parseBody(block.body)
  if (!parsed) return undefined

  const options: ChoicesOption[] = []
  parsed.options.forEach((o, i) => {
    const label = str(o?.label)
    if (!label) return
    const detail = str(o?.detail)
    options.push({ id: str(o?.id) || `opt:${i}`, label, ...(detail ? { detail } : {}) })
  })
  if (options.length === 0) return undefined

  const title = str(parsed.record.title) || 'Which option?'
  const rec = str(parsed.record.recommended)
  const recommended = rec ? (options.find(o => o.id === rec) ?? options.find(o => o.label === rec))?.id : undefined
  return { title, options, ...(recommended ? { recommended } : {}) }
}

/**
 * Parse a trailing `await-multiselect` block (#339), the multi twin of
 * {@link parseChoicesGate}. Each option may start checked via `default`. Same
 * tolerance: synthesized ids, blank-title fallback, malformed block ignored.
 */
export function parseMultiSelectGate(text: string): ParsedMultiSelectGate | undefined {
  const block = lastBlock(text, 'await-multiselect')
  if (!block) return undefined
  const parsed = parseBody(block.body)
  if (!parsed) return undefined

  const options: MultiSelectOption[] = []
  parsed.options.forEach((o, i) => {
    const label = str(o?.label)
    if (!label) return
    const detail = str(o?.detail)
    options.push({ id: str(o?.id) || `opt:${i}`, label, ...(detail ? { detail } : {}), ...(o?.default === true ? { default: true } : {}) })
  })
  if (options.length === 0) return undefined

  return { title: str(parsed.record.title) || 'Select any that apply', options }
}

/**
 * Parse a trailing `await-confirmation` block (#358): a plan/document approval,
 * e.g. the #326 large-scope flow's PLAN file (`showMarkdown()` + AWAIT). No
 * options — the gate is a fixed Approve / Decline. Same tolerance as the other
 * parsers: blank-title fallback, malformed block ignored.
 */
export function parseConfirmationGate(text: string): ParsedConfirmationGate | undefined {
  const block = lastBlock(text, 'await-confirmation')
  if (!block) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(block.body)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const file = str(record.file)
  return { title: str(record.title) || 'Approve this plan?', ...(file ? { file } : {}) }
}

/**
 * Parse whichever await gate a build turn ended on (#337 / #339 / #358). When more
 * than one block kind is present (an agent shouldn't emit several), the one that
 * appears latest in the text wins; a malformed later block falls back to an earlier
 * one. Returns `undefined` when the agent just finished — the common case, so a
 * normal build flows straight through.
 */
export function parseAwaitGate(text: string): ParsedAwaitGate | undefined {
  const kinds: { at: number; parse: () => ParsedAwaitGate | undefined }[] = [
    {
      at: lastBlock(text, 'await-choices')?.index ?? -1,
      parse: () => {
        const g = parseChoicesGate(text)
        return g ? { kind: 'choices', ...g } : undefined
      },
    },
    {
      at: lastBlock(text, 'await-multiselect')?.index ?? -1,
      parse: () => {
        const g = parseMultiSelectGate(text)
        return g ? { kind: 'multi', ...g } : undefined
      },
    },
    {
      at: lastBlock(text, 'await-confirmation')?.index ?? -1,
      parse: () => {
        const g = parseConfirmationGate(text)
        return g ? { kind: 'confirm', ...g } : undefined
      },
    },
  ]
  for (const kind of kinds.filter(k => k.at >= 0).sort((a, b) => b.at - a.at)) {
    const gate = kind.parse()
    if (gate) return gate
  }
  return undefined
}
