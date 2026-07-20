import { PRESETS_MARKET_RESEARCH } from './prompts.generated.js'

/**
 * The [Market research] preset (#694): research the market, then queue a follow-up that turns the
 * findings into tickets. The two halves are deliberately separate runs — researching and deciding
 * what to build from the research are different jobs, and splitting them lets a human read the
 * findings before anything is proposed.
 *
 * `<SESSION_NAME>` rather than `${{ tf.session_name }}`, per #694: the session name does not exist
 * yet when a preset renders (the agent picks it early in the run), so interpolating here would
 * always produce an empty string. Deferring it to the agent is the fix, and the preset defines the
 * placeholder itself the way `research.md` does, so it still resolves under `--vanilla`, where
 * there is no system prompt to define it.
 */

/** The preset's run-kind name, as the dashboard menu uses it. */
export const MARKET_RESEARCH_PRESET_NAME = 'market-research'

/** The prompt, from `prompts/presets/market_research.md`. */
export const MARKET_RESEARCH_PROMPT_TEMPLATE = PRESETS_MARKET_RESEARCH

/** No user params: the prompt takes no blank to fill. */
export const MARKET_RESEARCH_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderMarketResearchPrompt = (): string => MARKET_RESEARCH_PROMPT_TEMPLATE
