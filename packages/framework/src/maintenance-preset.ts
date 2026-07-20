import { definePreset } from './preset-prompt.js'
import { PRESETS_MAINTENANCE } from './prompts.generated.js'

/**
 * The [Maintenance] preset (#881): a codebase-wide sweep that does not refactor anything itself.
 * It looks for subsets that need work and queues one [Maintainability] and one [Security audit]
 * entry per subset in `TODO_AGENTS.md`, so the backlog loop does the actual work later, one
 * bounded piece at a time. [Readability] joins them only under `technical_control`.
 *
 * Why it exists alongside the on-before-mergeable maintenance block (#326): that block only ever
 * sees the changes one session introduced. A repo that adopted The Framework late has a whole
 * history no session ever touched, and this is what reaches it (#882 fires it on a schedule).
 *
 * The template is flattened rather than copied verbatim from the issue: `${{ }}` fragments cannot
 * nest (the scanner stops at the first `}}`), so the conditional line concatenates instead.
 */
const maintenance = definePreset('maintenance', PRESETS_MAINTENANCE, 'What to analyze for refactor opportunities')

/** The preset's run-kind name, as the dashboard button uses it. */
export const MAINTENANCE_PRESET_NAME = maintenance.name
/** The one user param: what to sweep. Defaults to the launching session, else the whole codebase. */
export const MAINTENANCE_PARAMS = maintenance.params
/** The prompt template, from `prompts/presets/maintenance.md`. */
export const MAINTENANCE_PROMPT_TEMPLATE = maintenance.template
/** Render the Maintenance prompt, filling its `${{ tf.params.what }}` blank. */
export const renderMaintenancePrompt = maintenance.render
