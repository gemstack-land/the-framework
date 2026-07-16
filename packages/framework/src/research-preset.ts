import { renderTemplate } from './prompt-template.js'
import { PRESETS_RESEARCH } from './prompts.generated.js'

/**
 * The [Research] preset (#331): Rom's problem-variability review, shipped as a
 * direct prompt (see `runPrompt`) rather than a build run — research reviews
 * existing code, so it skips the scope -> build scaffolding. The
 * `${{ tf.params.what }}` placeholder is the user-facing blank (#330); the CAPS tokens
 * (`<AWAIT>`, `<REVIEW_FILE>`, …) are agent-facing macros defined at the bottom
 * of the prompt itself, and `showMultiSelect()` + `<AWAIT>` becomes a live
 * turn-boundary gate (#339/#340) the dashboard resolves.
 */

/** The preset's name, as the CLI subcommand and the dashboard button use it. */
export const RESEARCH_PRESET_NAME = 'research'

/** The one user param: what to measure. Defaults to `this PR`, per the issue. */
export const RESEARCH_PARAMS = [
  { name: 'what', default: 'this PR', description: 'What to measure problem variability of' },
] as const

/** The prompt template, verbatim from #331 (with `${{ tf.params.what }}` as the blank). */
export const RESEARCH_PROMPT_TEMPLATE = PRESETS_RESEARCH

/**
 * Render the Research prompt for a target, filling its `${{ tf.params.what }}`
 * blank (#326). A blank / omitted `what` falls back to the declared default
 * (`this PR`), so the dashboard button and a bare `framework research` both run
 * with zero input.
 */
export function renderResearchPrompt(what?: string): string {
  const value = what?.trim() || RESEARCH_PARAMS[0].default
  return renderTemplate(RESEARCH_PROMPT_TEMPLATE, { tf: { params: { what: value } } })
}
