import { renderTemplate } from './prompt-template.js'
import { ON_BEFORE_MERGEABLE_PROMPT } from './prompts.generated.js'
import { presetContext } from './presets.js'
import { dropSection, type EcoOptions, type TfContext } from './system-prompt.js'

/**
 * The on-before-mergeable prompt (#326), in `prompts/on_before_mergeable_prompt.md` (#551).
 *
 * It does not *run* the quality presets, it *queues* them: one agent turn that appends
 * "Apply <preset filePath> with tf.params.what set to ..." entries to the session's TODO
 * file, which the backlog loop (#323/#538) picks up later. That is the whole point of
 * #556 — the previous suite executed maintainability, readability and security-audit as
 * three child runs on the spot, which does not compose with the queue.
 *
 * Flattened rather than verbatim, which is the one place this departs from the doc: the
 * doc nests `${{ tf.session_name }}` inside the outer `${{ ... }}` and puts backticks
 * inside a backtick template literal. {@link renderTemplate}'s fragment regex is
 * non-greedy, so the outer fragment closes on the inner `}}` and the remainder is not
 * valid JS. Same branch, same output, one fragment.
 *
 * Two sections: `## Maintenance` queues the quality presets, and `## Business knowledge`
 * (#537) asks the agent to fold what it learned back into {@link KNOWLEDGE_DOCS}.
 */
export const ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE = ON_BEFORE_MERGEABLE_PROMPT

/** The section `EcoOptions.autoMaintenance` drops (#314). */
const MAINTENANCE_HEADING = '## Maintenance'

/** What the on-before-mergeable prompt's fragments read. A subset of {@link TfContext}. */
export interface OnBeforeMergeableContext {
  /** The session the finished run named via setSessionName(). Every line of the prompt names it. */
  session_name: string
  /** The user's settings; `technical_control` gates the readability entry. Absent means off. */
  settings?: TfContext['settings']
  /**
   * The materialized presets, stem -> `{ filePath }` (#326). The `## Maintenance` entries carry
   * `tf.presets.<name>.filePath` so the picked-up agent opens the real preset file. Defaulted
   * from {@link presetContext}, so callers get the standard `.the-framework/presets/*.md` paths.
   */
  presets?: Record<string, { filePath: string }>
}

/**
 * Render the on-before-mergeable prompt for a finished session. `settings` is defaulted rather than
 * left absent: the template reads `tf.settings.technical_control`, so a missing `settings`
 * throws a {@link TemplateFragmentError} instead of reading as off.
 *
 * `eco.autoMaintenance` (#314) drops `## Maintenance` here rather than skipping the whole
 * run: since #537 the prompt also carries `## Business knowledge`, which the flag does not
 * name and must not silently take with it. Dropped before rendering, so the dropped
 * section's fragments never evaluate.
 */
export function renderOnBeforeMergeablePrompt(tf: OnBeforeMergeableContext, eco?: EcoOptions | undefined): string {
  const template = eco?.autoMaintenance
    ? dropSection(ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE, MAINTENANCE_HEADING)
    : ON_BEFORE_MERGEABLE_PROMPT_TEMPLATE
  return renderTemplate(template, {
    tf: { ...tf, settings: tf.settings ?? {}, presets: tf.presets ?? presetContext() },
  })
}
