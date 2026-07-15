import { renderPresetPrompt, type PresetParam } from './preset-params.js'
import { PRESETS_READABILITY } from './prompts.generated.js'

/**
 * The [Readability] preset (#360): Rom's refactor-for-human-readers pass, shipped
 * as a direct prompt like [Research] (#331) — it reworks existing code, so it
 * skips the scope -> build scaffolding. `<PARAM:what>` is the
 * user-facing blank (#330); `<FUNCTION>` is an agent-facing macro defined at the
 * bottom of the prompt itself, like the Research preset's CAPS tokens.
 */

/** The preset's name, as the dashboard button uses it. */
export const READABILITY_PRESET_NAME = 'readability'

/** The one user param: what to refactor. Defaults to `this PR`, like Research. */
export const READABILITY_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to refactor for readability' },
]

/** The prompt template, verbatim from #360 (with `<PARAM:what>` as the blank). */
export const READABILITY_PROMPT_TEMPLATE = PRESETS_READABILITY

/**
 * Render the Readability prompt for a target. A blank / omitted `what` falls
 * back to the declared default (`this PR`), so the dashboard button runs with
 * zero input.
 */
export function renderReadabilityPrompt(what?: string): string {
  return renderPresetPrompt(READABILITY_PROMPT_TEMPLATE, {
    params: READABILITY_PARAMS,
    values: { what },
  })
}
