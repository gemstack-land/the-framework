---
'@gemstack/framework': minor
---

Post-merge now queues the quality follow-ups instead of running them (#556), which is what the #326 doc says and what composes with the backlog loop (#323/#538). On `setReadyForMerge()`, a `--post-merge` run used to fire maintainability, readability and security-audit as three child `framework prompt` runs back to back, on the spot. It now fires one short turn that appends "Apply preset X on the changes introduced by <session>" entries to the session's TODO file, and lets the loop pick them up. Cheaper by a lot: a few TODO lines rather than three full preset passes serialized on the same git index.

The readability entry is gated on Technical control, per the doc. That setting already existed as a preference, a `--technical` flag and a Global options toggle; it just never reached the prompts, so `TfContext` gains `settings.technical_control` and `session_name`. The session name is carried on run state: the agent sets it before its first change and the post-merge prompt reads it afterwards.

`--eco-auto-maintenance` does something again. #326 moved the maintenance section out of the system prompt, which left the flag inert (#555); the post-merge prompt is exactly that section, so the flag now skips it.

The post-merge prompt is flattened rather than verbatim from the doc, and this is the one place the prompts depart from it. The doc nests `${{ tf.session_name }}` inside the outer `${{ ... }}` and puts backticks inside a backtick template literal; the fragment regex is non-greedy, so the outer fragment closes on the inner `}}` and what is left is not valid JS. It throws `TemplateFragmentError` today, with or without the new context fields. Same branch, same output, one fragment, and a test now rejects any nested fragment so the prompt cannot regress into a shape that will not render.

`POST_MERGE_PASSES` and `runPostMergeSuite` are replaced by `runPostMerge` and `renderPostMergePrompt`. The three preset modules are untouched: the dashboard buttons still use them.
