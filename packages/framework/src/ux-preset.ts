import { definePreset } from './preset-prompt.js'
import { PRESETS_UX } from './prompts.generated.js'

/**
 * The [UX] preset (#472): Rom's usability review, shipped like [Research] (#331)
 * as a direct interactive prompt rather than a build run — it reviews existing UI
 * from a user's perspective, so it skips the scope -> build scaffolding. It enumerates every finding as a `showChoices()` list, stops at
 * `<AWAIT>` for the user to accept proposals, then works on the accepted ones.
 * `${{ tf.params.what }}` is the user-facing blank (defaults to the launching session, else the whole codebase); `<AWAIT>` is the
 * agent-facing turn-gate macro (#339/#340) the dashboard resolves. Keep it in sync
 * with the issue rather than growing it here.
 */
const ux = definePreset('ux', PRESETS_UX, 'What to review the UX of')

/** The preset's name, as the dashboard button uses it. */
export const UX_PRESET_NAME = ux.name
/** The one user param: what to review. Defaults to the launching session, else the whole codebase (#874). */
export const UX_PARAMS = ux.params
/** The prompt template, from #472 (with `${{ tf.params.what }}` as the blank, `<AWAIT>` as the gate). */
export const UX_PROMPT_TEMPLATE = ux.template
/** Render the UX prompt, filling its `${{ tf.params.what }}` blank (defaults to the launching session, else the whole codebase). */
export const renderUxPrompt = ux.render
