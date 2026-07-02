import { parseSkillManifest } from '@gemstack/ai-skills'
import type { Prompt } from './types.js'

/** Thrown when a prompt bundle's metadata is malformed. */
export class PromptError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'PromptError'
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function str(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/**
 * Parse a prompt bundle (a `SKILL.md`-shaped markdown file) into a {@link Prompt}.
 *
 * Reuses `@gemstack/ai-skills`' frontmatter parser, then reads the prompt-specific
 * fields out of `metadata`: `title`, `loopId` (the dispatch id; defaults to the
 * manifest name), `passes` (positive integer, default 1), and `event`.
 */
export function parsePrompt(markdown: string, source?: string): Prompt {
  const { manifest, instructions } = parseSkillManifest(markdown, source)
  if (!instructions.trim()) throw new PromptError(`prompt "${manifest.name}" has an empty body`)

  const meta = manifest.metadata ?? {}
  const id = str(meta, 'loopId') ?? manifest.name
  if (!KEBAB.test(id)) throw new PromptError(`prompt "${manifest.name}" id must be kebab-case: ${JSON.stringify(id)}`)

  let passes = 1
  if (meta.passes !== undefined) {
    if (!Number.isInteger(meta.passes) || (meta.passes as number) < 1) {
      throw new PromptError(`prompt "${manifest.name}" passes must be a positive integer, got ${meta.passes}`)
    }
    passes = meta.passes as number
  }

  const event = str(meta, 'event')

  return Object.freeze({
    id,
    name: manifest.name,
    title: str(meta, 'title') ?? manifest.name,
    description: manifest.description,
    instructions,
    passes,
    ...(event ? { event } : {}),
    appliesTo: Object.freeze([...(manifest.appliesTo ?? [])]),
  })
}
