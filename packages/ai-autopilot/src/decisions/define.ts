import type { Decision, DecisionSpec, DecisionStatus } from './types.js'

const STATUSES: readonly DecisionStatus[] = ['rejected', 'accepted', 'superseded']

/** Thrown when a {@link DecisionSpec} is malformed. Fails fast at record time. */
export class DecisionError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'DecisionError'
  }
}

/** Turn free text into a kebab-case slug (used for a decision id). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

/** Split text into lowercased word tokens, dropping short/stop words. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'use',
  'using', 'via', 'we', 'our', 'it', 'is', 'as', 'by', 'at', 'be', 'this', 'that',
])
export function tokenize(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue
    seen.add(raw)
  }
  return [...seen]
}

/**
 * Validate a {@link DecisionSpec} and return a frozen {@link Decision}.
 *
 * Defaults keep the call site terse: `status` is `rejected` (the common case),
 * `tags` is empty, and `id` is a slug of the title. Optional fields are omitted
 * entirely rather than set to `undefined`, so the record stays clean under
 * `exactOptionalPropertyTypes`.
 */
export function defineDecision(spec: DecisionSpec): Decision {
  const title = spec.title?.trim()
  if (!title) throw new DecisionError('decision title is required')
  const rationale = spec.rationale?.trim()
  if (!rationale) throw new DecisionError(`decision "${title}" needs a rationale`)

  const status = spec.status ?? 'rejected'
  if (!STATUSES.includes(status)) {
    throw new DecisionError(`decision "${title}" has an unknown status: ${JSON.stringify(status)}`)
  }

  const id = (spec.id?.trim() ? slugify(spec.id) : slugify(title))
  if (!id) throw new DecisionError(`decision "${title}" produced an empty id; give it an explicit id`)

  const tags = Object.freeze(
    [...new Set((spec.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean))],
  )

  const decision: Decision = {
    id,
    title,
    status,
    rationale,
    tags,
    ...(spec.date?.trim() ? { date: spec.date.trim() } : {}),
    ...(spec.supersededBy?.trim() ? { supersededBy: slugify(spec.supersededBy) } : {}),
  }
  return Object.freeze(decision)
}
