import { renderPresetPrompt, type PresetParam } from './preset-params.js'

/**
 * The [Maintainability] preset (#361): Rom's refactor-for-future-changes pass,
 * shipped as a direct prompt like [Readability] (#360). The prompt is
 * deliberately minimal — Rom wants to see how it performs before developing a
 * more explicit one, so keep it in sync with the issue rather than growing it here.
 */

/** The preset's name, as the dashboard button uses it. */
export const MAINTAINABILITY_PRESET_NAME = 'maintainability'

/** The one user param: what to refactor. Defaults to `this PR`, like the others. */
export const MAINTAINABILITY_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to refactor for maintainability' },
]

/** The prompt template, verbatim from #361 (with `<PARAM:what>` as the blank). */
export const MAINTAINABILITY_PROMPT_TEMPLATE = `Refactor <PARAM:what> to make it as maintainable as possible:
- Look for maintainability red flags, and fix them.`

/**
 * Render the Maintainability prompt for a target. A blank / omitted `what`
 * falls back to the declared default (`this PR`).
 */
export function renderMaintainabilityPrompt(what?: string): string {
  return renderPresetPrompt(MAINTAINABILITY_PROMPT_TEMPLATE, {
    params: MAINTAINABILITY_PARAMS,
    values: { what },
  })
}
