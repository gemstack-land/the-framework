import { PRESETS_DRAIN_QUEUE } from './prompts.generated.js'

/**
 * The [Drain queue] preset (#855): work the first open entry of `TODO_AGENTS.md` and check it
 * off. This is the half of the cycle auto PM was missing — [Quick wins] and [Spike & plan] only
 * ever *fill* the queue, and the in-session backlog loop only exists inside a run a human
 * started, so an unattended daemon filled the queue once and then refused forever.
 *
 * One entry per run, not the whole backlog: the sweep's cooldown and quota gate then apply per
 * entry, so a long queue is spent deliberately rather than in one unattended burst.
 *
 * The wording mirrors the in-session backlog loop's own per-item prompt, so both paths ask the
 * agent for the same thing and a queue drained either way looks the same afterwards.
 */

/** The preset's run-kind name, as the dashboard button uses it. */
export const DRAIN_QUEUE_PRESET_NAME = 'drain-queue'

/** The prompt, from `prompts/presets/drain_queue.md`. */
export const DRAIN_QUEUE_PROMPT_TEMPLATE = PRESETS_DRAIN_QUEUE

/** No user params: the whole prompt is the one line, so there is nothing to fill. */
export const DRAIN_QUEUE_PARAMS: readonly [] = []

/** Render the prompt. Paramless, so it is the template verbatim. */
export const renderDrainQueuePrompt = (): string => DRAIN_QUEUE_PROMPT_TEMPLATE
