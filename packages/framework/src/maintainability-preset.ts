import { definePreset } from './preset-prompt.js'
import { PRESETS_MAINTAINABILITY } from './prompts.generated.js'

/**
 * The [Maintainability] preset (#361): Rom's refactor-for-future-changes pass,
 * shipped as a direct prompt like [Readability] (#360). The prompt is
 * deliberately minimal — Rom wants to see how it performs before developing a
 * more explicit one, so keep it in sync with the issue rather than growing it here.
 */
const maintainability = definePreset('maintainability', PRESETS_MAINTAINABILITY, 'What to refactor for maintainability')

/** The preset's name, as the dashboard button uses it. */
export const MAINTAINABILITY_PRESET_NAME = maintainability.name
/** The one user param: what to refactor. Defaults to the launching session, else the whole codebase (#874). */
export const MAINTAINABILITY_PARAMS = maintainability.params
/** The prompt template, verbatim from #361, in `prompts/presets/maintainability.md` (#551). */
export const MAINTAINABILITY_PROMPT_TEMPLATE = maintainability.template
/** Render the Maintainability prompt, filling its `${{ tf.params.what }}` blank (defaults to the launching session, else the whole codebase). */
export const renderMaintainabilityPrompt = maintainability.render
