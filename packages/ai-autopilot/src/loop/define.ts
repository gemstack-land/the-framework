import type { LoopPrompt, LoopPromptSpec, LoopRule, LoopRuleSpec } from './types.js'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Thrown when a loop prompt or rule is malformed. Fails fast at definition. */
export class LoopError extends Error {
  constructor(message: string) {
    super(`[ai-autopilot] ${message}`)
    this.name = 'LoopError'
  }
}

/**
 * Validate a {@link LoopPromptSpec} and return a frozen {@link LoopPrompt}.
 * `passes` defaults to 1 and must be a positive integer.
 */
export function definePrompt(spec: LoopPromptSpec): LoopPrompt {
  const id = spec.id?.trim()
  if (!id) throw new LoopError('prompt id is required')
  if (!KEBAB.test(id)) throw new LoopError(`prompt id must be kebab-case: ${JSON.stringify(spec.id)}`)
  if (typeof spec.run !== 'function') throw new LoopError(`prompt "${id}" needs a run function`)

  const passes = spec.passes ?? 1
  if (!Number.isInteger(passes) || passes < 1) {
    throw new LoopError(`prompt "${id}" passes must be a positive integer, got ${spec.passes}`)
  }

  return Object.freeze({ id, passes, run: spec.run })
}

/**
 * Validate a {@link LoopRuleSpec} and return a frozen {@link LoopRule}. `on` is
 * normalized to a de-duped list of event kinds; `run` is the ordered prompt ids.
 */
export function defineRule(spec: LoopRuleSpec): LoopRule {
  const kinds = (Array.isArray(spec.on) ? spec.on : [spec.on]).map(k => k?.trim()).filter(Boolean)
  if (kinds.length === 0) throw new LoopError('rule `on` needs at least one event kind')

  const run = (spec.run ?? []).map(p => p?.trim()).filter(Boolean)
  if (run.length === 0) throw new LoopError(`rule on [${kinds.join(', ')}] needs at least one prompt in \`run\``)

  return Object.freeze({
    on: Object.freeze([...new Set(kinds)]),
    run: Object.freeze([...run]),
  })
}
