import { PRESETS_SPIKE_AND_PLAN } from './prompts.generated.js'

/**
 * The [Spike & plan] preset (#685): the Agentic PM deep-dive prompt, the step between the
 * #462 [Suggest new tickets] ideation and actually building something. It turns a bare
 * `tickets/<DATE>_<SLUG>.md` into the `.spike.md` / `.plan.md` companions the #684 format
 * defines, so a later run has something concrete to work from.
 *
 * A single line, for the same reason #674 cut the ideation preset down to one: the #683
 * run-start context fragment already points the agent at `tickets/**.md` and the #684
 * format spec, so re-teaching the file shape here would be babysitting — which is brittle,
 * and goes stale the moment the format moves.
 */

/** The preset's run-kind name, as the dashboard button uses it. */
export const SPIKE_AND_PLAN_PRESET_NAME = 'spike-and-plan'

/** The prompt, from `prompts/presets/spike_and_plan.md`: a single line, per the #674 lesson. */
export const SPIKE_AND_PLAN_PROMPT_TEMPLATE = PRESETS_SPIKE_AND_PLAN

/** No user params: the whole prompt is the one line, so there is nothing to fill. */
export const SPIKE_AND_PLAN_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderSpikeAndPlanPrompt = (): string => SPIKE_AND_PLAN_PROMPT_TEMPLATE
