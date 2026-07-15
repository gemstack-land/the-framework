import { renderPresetPrompt, type PresetParam } from './preset-params.js'
import { PRESETS_RESEARCH } from './prompts.generated.js'

/**
 * The [Research] preset (#331): Rom's problem-variability review, shipped as a
 * direct prompt (see `runPrompt`) rather than a build run — research reviews
 * existing code, so it skips the scope -> build scaffolding. The
 * `<PARAM:what>` placeholder is the user-facing blank (#330); the CAPS tokens
 * (`<AWAIT>`, `<REVIEW_FILE>`, …) are agent-facing macros defined at the bottom
 * of the prompt itself, and `showMultiSelect()` + `<AWAIT>` becomes a live
 * turn-boundary gate (#339/#340) the dashboard resolves.
 */

/** The preset's name, as the CLI subcommand and the dashboard button use it. */
export const RESEARCH_PRESET_NAME = 'research'

/** The one user param: what to measure. Defaults to `this PR`, per the issue. */
export const RESEARCH_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to measure problem variability of' },
]

/** The prompt template, verbatim from #331 (with `<PARAM:what>` as the blank). */
export const RESEARCH_PROMPT_TEMPLATE = PRESETS_RESEARCH

/**
 * Render the Research prompt for a target. A blank / omitted `what` falls back
 * to the declared default (`this PR`), so the dashboard button and a bare
 * `framework research` both run with zero input.
 */
export function renderResearchPrompt(what?: string): string {
  return renderPresetPrompt(RESEARCH_PROMPT_TEMPLATE, {
    params: RESEARCH_PARAMS,
    values: { what },
  })
}
