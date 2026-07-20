import { PRESETS_TRIAGE_QUICK, PRESETS_TRIAGE_CONSENSUAL } from './prompts.generated.js'

/**
 * The triage presets (#891, #892): read `tickets/*.md`, pick the ones that match one filter, and
 * append them to `TODO_AGENTS.md`. They are how the queue refills itself from the ticket backlog,
 * where [Quick wins] (#773) refills it from the `.plan.md` companions that already exist.
 *
 * The pair splits on cost, and the split is the whole point: both are consensual (zero open
 * questions, zero variability), so neither needs a human, and they differ only in whether the
 * work is cheap. Keeping them apart lets the rotation queue the cheap batch and the significant
 * batch on separate turns rather than in one indiscriminate sweep.
 *
 * The gated third sibling (#698, complex work) is deliberately absent here: it ends in `<AWAIT>`,
 * so firing it unattended would wedge a run against a human who is not there. It ships separately
 * as [Suggest tickets to work on] and stays out of {@link AUTO_PM_JOBS}.
 *
 * Each prompt pins its own `<SESSION_NAME>` and aborts when `the-framework/<SESSION_NAME>` already
 * exists. That is the collision guard, and it is what makes them safe to fire on a schedule: a
 * triage still in flight owns the branch, so the next firing does nothing instead of triaging the
 * same tickets twice.
 */

/** A triage preset's public shape. Paramless: the prompt scopes itself to the repo's tickets. */
interface TriagePreset {
  /** The run-kind name, as the dashboard button uses it. */
  name: string
  /** The prompt template, from `prompts/presets/<stem>.md`. */
  template: string
  /** No user params, so nothing to fill. */
  params: readonly []
  /** Render the prompt. Paramless, so it is the template verbatim. */
  render: () => string
}

/**
 * Define one triage preset. The two differ by a single clause in the prompt and by their session
 * name, so the shape lives here once — the same reason {@link definePreset} exists for the quality
 * presets, minus the `what` param these have no use for.
 */
function defineTriagePreset(name: string, template: string): TriagePreset {
  return { name, template, params: [] as const, render: () => template }
}

/** [Do quick-win work] (#891): tickets that are quick-wins *and* consensual. */
const triageQuick = defineTriagePreset('triage-quick', PRESETS_TRIAGE_QUICK)

/** [Do consensual work] (#892): tickets that are consensual but *not* quick-wins. */
const triageConsensual = defineTriagePreset('triage-consensual', PRESETS_TRIAGE_CONSENSUAL)

/** The [Do quick-win work] run-kind name (#891). */
export const TRIAGE_QUICK_PRESET_NAME = triageQuick.name
/** The [Do quick-win work] prompt template. */
export const TRIAGE_QUICK_PROMPT_TEMPLATE = triageQuick.template
/** No user params. */
export const TRIAGE_QUICK_PARAMS = triageQuick.params
/** Render the [Do quick-win work] prompt. */
export const renderTriageQuickPrompt = triageQuick.render

/** The [Do consensual work] run-kind name (#892). */
export const TRIAGE_CONSENSUAL_PRESET_NAME = triageConsensual.name
/** The [Do consensual work] prompt template. */
export const TRIAGE_CONSENSUAL_PROMPT_TEMPLATE = triageConsensual.template
/** No user params. */
export const TRIAGE_CONSENSUAL_PARAMS = triageConsensual.params
/** Render the [Do consensual work] prompt. */
export const renderTriageConsensualPrompt = triageConsensual.render
