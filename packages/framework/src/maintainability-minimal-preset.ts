import { renderPresetPrompt, type PresetParam } from './preset-params.js'

/**
 * The [Maintainability (minimal)] preset (#362): the barest form of Rom's
 * maintainability pass, the red-flags line alone, with no target scope and no
 * goal framing. It ships beside the fuller [Maintainability] (#361) as a
 * deliberate A/B: #361 adds a `<PARAM:what>` target and a "make it as
 * maintainable as possible" framing line, #362 drops both. Rom wants to see
 * which performs better, so keep this verbatim from the issue. Once the
 * comparison settles, the losing variant (this or #361) gets removed.
 */

/** The preset's name, as the dashboard note uses it. */
export const MAINTAINABILITY_MINIMAL_PRESET_NAME = 'maintainability-minimal'

/** No user params: #362 is deliberately unscoped (it acts on the session's work). */
export const MAINTAINABILITY_MINIMAL_PARAMS: readonly PresetParam[] = []

/** The prompt template, verbatim from #362: the red-flags line, nothing more. */
export const MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE = `Look for maintainability red flags, and fix them.`

/** Render the minimal Maintainability prompt. It has no blanks, so it renders as-is. */
export function renderMaintainabilityMinimalPrompt(): string {
  return renderPresetPrompt(MAINTAINABILITY_MINIMAL_PROMPT_TEMPLATE, {
    params: MAINTAINABILITY_MINIMAL_PARAMS,
  })
}
