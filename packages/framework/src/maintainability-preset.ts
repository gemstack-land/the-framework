import { renderTemplate } from './prompt-template.js'
import { PRESETS_MAINTAINABILITY } from './prompts.generated.js'

/**
 * The [Maintainability] preset (#361): Rom's refactor-for-future-changes pass,
 * shipped as a direct prompt like [Readability] (#360). The prompt is
 * deliberately minimal — Rom wants to see how it performs before developing a
 * more explicit one, so keep it in sync with the issue rather than growing it here.
 */

/** The preset's name, as the dashboard button uses it. */
export const MAINTAINABILITY_PRESET_NAME = 'maintainability'

/** The one user param: what to refactor. Defaults to `this PR`, like the others. */
export const MAINTAINABILITY_PARAMS = [
  { name: 'what', default: 'this PR', description: 'What to refactor for maintainability' },
] as const

/** The prompt template, verbatim from #361, in `prompts/presets/maintainability.md` (#551). */
export const MAINTAINABILITY_PROMPT_TEMPLATE = PRESETS_MAINTAINABILITY

/**
 * Render the Maintainability prompt for a target, filling its `${{ tf.params.what }}`
 * blank (#326). A blank / omitted `what` falls back to the declared default (`this PR`).
 */
export function renderMaintainabilityPrompt(what?: string): string {
  const value = what?.trim() || MAINTAINABILITY_PARAMS[0].default
  return renderTemplate(MAINTAINABILITY_PROMPT_TEMPLATE, { tf: { params: { what: value } } })
}
