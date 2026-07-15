import { renderPresetPrompt, type PresetParam } from './preset-params.js'
import { PRESETS_UX } from './prompts.generated.js'

/**
 * The [UX] preset (#472): Rom's usability review, shipped like [Research] (#331)
 * as a direct interactive prompt rather than a build run — it reviews existing UI
 * from a user's perspective, so it skips the scope -> build scaffolding. It enumerates every finding as a `showChoices()` list, stops at
 * `<AWAIT>` for the user to accept proposals, then works on the accepted ones.
 * `<PARAM:what>` is the user-facing blank (defaults to `this PR`); `<AWAIT>` is the
 * agent-facing turn-gate macro (#339/#340) the dashboard resolves. Keep it in sync
 * with the issue rather than growing it here.
 */

/** The preset's name, as the dashboard button uses it. */
export const UX_PRESET_NAME = 'ux'

/** The one user param: what to review. Defaults to `this PR`, like the others. */
export const UX_PARAMS: readonly PresetParam[] = [
  { name: 'what', default: 'this PR', description: 'What to review the UX of' },
]

/** The prompt template, from #472 (with `<PARAM:what>` as the blank, `<AWAIT>` as the gate). */
export const UX_PROMPT_TEMPLATE = PRESETS_UX

/**
 * Render the UX prompt for a target. A blank / omitted `what` falls back to the
 * declared default (`this PR`), so the dashboard button runs with zero input.
 */
export function renderUxPrompt(what?: string): string {
  return renderPresetPrompt(UX_PROMPT_TEMPLATE, {
    params: UX_PARAMS,
    values: { what },
  })
}
