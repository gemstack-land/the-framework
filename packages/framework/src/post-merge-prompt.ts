import { renderTemplate } from './prompt-template.js'
import { POST_MERGE_PROMPT } from './prompts.generated.js'
import type { TfContext } from './system-prompt.js'

/**
 * The post-merge prompt (#326), in `prompts/post_merge_prompt.md` (#551).
 *
 * It does not *run* the quality presets, it *queues* them: one agent turn that appends
 * "Apply preset X on the changes introduced by <session>" entries to the session's TODO
 * file, which the backlog loop (#323/#538) picks up later. That is the whole point of
 * #556 — the previous suite executed maintainability, readability and security-audit as
 * three child runs on the spot, which does not compose with the queue.
 *
 * Flattened rather than verbatim, which is the one place this departs from the doc: the
 * doc nests `${{ tf.session_name }}` inside the outer `${{ ... }}` and puts backticks
 * inside a backtick template literal. {@link renderTemplate}'s fragment regex is
 * non-greedy, so the outer fragment closes on the inner `}}` and the remainder is not
 * valid JS. Same branch, same output, one fragment.
 */
export const POST_MERGE_PROMPT_TEMPLATE = POST_MERGE_PROMPT

/** What the post-merge prompt's fragments read. A subset of {@link TfContext}. */
export interface PostMergeContext {
  /** The session the finished run named via setSessionName(). Every line of the prompt names it. */
  session_name: string
  /** The user's settings; `technical_control` gates the readability entry. Absent means off. */
  settings?: TfContext['settings']
}

/**
 * Render the post-merge prompt for a finished session. `settings` is defaulted rather than
 * left absent: the template reads `tf.settings.technical_control`, so a missing `settings`
 * throws a {@link TemplateFragmentError} instead of reading as off.
 */
export function renderPostMergePrompt(tf: PostMergeContext): string {
  return renderTemplate(POST_MERGE_PROMPT_TEMPLATE, { tf: { ...tf, settings: tf.settings ?? {} } })
}
