import { renderTemplate } from './prompt-template.js'
import { PRESETS_READABILITY } from './prompts.generated.js'

/**
 * The [Readability] preset (#360): Rom's refactor-for-human-readers pass, shipped
 * as a direct prompt like [Research] (#331) — it reworks existing code, so it
 * skips the scope -> build scaffolding. `${{ tf.params.what }}` is the
 * user-facing blank (#330); `<FUNCTION>` is an agent-facing macro defined at the
 * bottom of the prompt itself, like the Research preset's CAPS tokens.
 */

/** The preset's name, as the dashboard button uses it. */
export const READABILITY_PRESET_NAME = 'readability'

/** The one user param: what to refactor. Defaults to `this PR`, like Research. */
export const READABILITY_PARAMS = [
  { name: 'what', default: 'this PR', description: 'What to refactor for readability' },
] as const

/** The prompt template, verbatim from #360 (with `${{ tf.params.what }}` as the blank). */
export const READABILITY_PROMPT_TEMPLATE = PRESETS_READABILITY

/**
 * Render the Readability prompt for a target, filling its `${{ tf.params.what }}`
 * blank (#326). A blank / omitted `what` falls back to the declared default
 * (`this PR`), so the dashboard button runs with zero input.
 */
export function renderReadabilityPrompt(what?: string): string {
  const value = what?.trim() || READABILITY_PARAMS[0].default
  return renderTemplate(READABILITY_PROMPT_TEMPLATE, { tf: { params: { what: value } } })
}
