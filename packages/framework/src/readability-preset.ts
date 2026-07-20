import { definePreset } from './preset-prompt.js'
import { PRESETS_READABILITY } from './prompts.generated.js'

/**
 * The [Readability] preset (#360): Rom's refactor-for-human-readers pass, shipped
 * as a direct prompt like [Research] (#331) — it reworks existing code, so it
 * skips the scope -> build scaffolding. `${{ tf.params.what }}` is the
 * user-facing blank (#330); `<FUNCTION>` is an agent-facing macro defined at the
 * bottom of the prompt itself, like the Research preset's CAPS tokens.
 */
const readability = definePreset('readability', PRESETS_READABILITY, 'What to refactor for readability')

/** The preset's name, as the dashboard button uses it. */
export const READABILITY_PRESET_NAME = readability.name
/** The one user param: what to refactor. Defaults to the launching session, else the whole codebase (#874). */
export const READABILITY_PARAMS = readability.params
/** The prompt template, verbatim from #360 (with `${{ tf.params.what }}` as the blank). */
export const READABILITY_PROMPT_TEMPLATE = readability.template
/** Render the Readability prompt, filling its `${{ tf.params.what }}` blank (defaults to the launching session, else the whole codebase). */
export const renderReadabilityPrompt = readability.render
