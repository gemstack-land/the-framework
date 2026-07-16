---
"@gemstack/framework": minor
"@gemstack/framework-dashboard": patch
---

Rename the "post-merge" prompt to "on-before-mergeable" (#592). It fires on `setReadyForMerge()`, before the merge, so "post-merge" was a misnomer (Rom's call in #559). Renamed end to end: the `--post-merge` flag is now `--on-before-mergeable`; `runPostMerge` / `renderPostMergePrompt` / `PostMergeContext` / `POST_MERGE_PROMPT` become their `OnBeforeMergeable` equivalents; the prompt file is `on_before_mergeable_prompt.md`; and the dashboard preference key `postMergeQuality` is now `onBeforeMergeableQuality` (a saved toggle resets to its default once). No agent-facing prompt text changed: the string "post-merge" never appeared in any prompt. The dashboard's visible "Post-merge cleanup" label is left as-is pending a copy decision.
