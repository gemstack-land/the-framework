import { PRESETS_QUICK_WINS } from './prompts.generated.js'

/**
 * The [Quick wins] preset (#773): harvest the cheap work out of the plans we already have.
 * It reads the `.plan.md` companions the #684 format defines and appends the quick ones to
 * `TODO_AGENTS.md`, which is the file a run drains — so the queue refills with work that is
 * already thought through, rather than with fresh ideas nobody has costed.
 *
 * The prompt is Rom's line from #773 verbatim, kept at one line for the #674 reason: the
 * #683 context fragment already names both `tickets/**.md` and the agent queue.
 *
 * This is the half of auto PM that closes the loop. [Spike & plan] (#685) turns tickets into
 * plans; this turns plans into queued work; the backlog loop drains the queue. Each step feeds
 * the next, so an idle machine keeps making progress instead of stalling at "no plans yet".
 */

/** The preset's run-kind name, as the dashboard button uses it. */
export const QUICK_WINS_PRESET_NAME = 'quick-wins'

/** The prompt, from `prompts/presets/quick_wins.md`: #773's line, unchanged. */
export const QUICK_WINS_PROMPT_TEMPLATE = PRESETS_QUICK_WINS

/** No user params: the whole prompt is the one line, so there is nothing to fill. */
export const QUICK_WINS_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderQuickWinsPrompt = (): string => QUICK_WINS_PROMPT_TEMPLATE
