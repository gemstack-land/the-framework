import { PRESETS_SUGGEST_TICKETS_TO_WORK_ON } from './prompts.generated.js'

/**
 * The [Suggest tickets to work on] preset (#698): the attended way to fill the agent queue.
 * It reads the tickets, proposes the ones worth doing next, and waits — the user ticks the
 * ones they accept, and only those land in `TODO_AGENTS.md`.
 *
 * The counterpart to the unattended path (#773), which harvests quick-wins on its own while
 * nobody is watching. Same destination, different question: this one asks "which of these
 * should we do?", that one takes only what is already cheap and planned.
 *
 * `<SHOW_CHOICES>` in the OP is rendered as `showMultiSelect()`, not `showChoices()`: the
 * spec wants each ticket pre-selected by confidence, and `showChoices()` is pick-exactly-one,
 * which has nowhere to put a per-entry default. `showMultiSelect()` maps onto the
 * `await-multiselect` block, whose options carry exactly that `default` flag.
 */

/** The preset's run-kind name, as the `/` menu uses it. */
export const SUGGEST_TICKETS_TO_WORK_ON_PRESET_NAME = 'suggest-tickets-to-work-on'

/** The prompt, from `prompts/presets/suggest_tickets_to_work_on.md`. */
export const SUGGEST_TICKETS_TO_WORK_ON_PROMPT_TEMPLATE = PRESETS_SUGGEST_TICKETS_TO_WORK_ON

/** No user params: the prompt scopes itself to the repo's tickets, so there is nothing to fill. */
export const SUGGEST_TICKETS_TO_WORK_ON_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderSuggestTicketsToWorkOnPrompt = (): string => SUGGEST_TICKETS_TO_WORK_ON_PROMPT_TEMPLATE
