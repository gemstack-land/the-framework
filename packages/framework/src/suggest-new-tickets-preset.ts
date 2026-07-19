import { PRESETS_SUGGEST_NEW_TICKETS } from './prompts.generated.js'

/**
 * The [Suggest new tickets] preset (#462): the Agentic PM ideation prompt, shipped like the
 * other presets as a direct interactive prompt rather than a build run. Per Rom's #674 call it
 * is a single line — "Suggest new tickets" — and lets the ambient context carry the rest: the
 * #683 run-start context fragment already points the agent at the existing `tickets/**.md` and
 * the #684 `.the-framework/ticketing-format.md` spec, so the prompt does not re-teach the ticket
 * format or spell out the flow. That is the #674 fix: an over-specified prompt is babysitting,
 * which is brittle and counter-productive. Per the settled #624 model the proposal IS the PR:
 * merging accepts the tickets, closing rejects them, so there is no separate proposal store.
 *
 * It has no params: the dashboard prefills this one line into the editor and the user edits it
 * freely (e.g. to scope the ideation), so there is no `${{ tf.params.what }}` blank to render.
 */

/** The preset's run-kind name, as the dashboard button uses it. */
export const SUGGEST_NEW_TICKETS_PRESET_NAME = 'suggest-new-tickets'

/** The prompt, from `prompts/presets/suggest_new_tickets.md`: a single line by #674 design. */
export const SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE = PRESETS_SUGGEST_NEW_TICKETS

/** No user params: the whole prompt is the one line, so there is nothing to fill. */
export const SUGGEST_NEW_TICKETS_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderSuggestNewTicketsPrompt = (): string => SUGGEST_NEW_TICKETS_PROMPT_TEMPLATE
