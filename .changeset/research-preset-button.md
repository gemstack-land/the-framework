---
'@gemstack/framework': minor
---

The [Research] preset (#331): `framework research [what]` and a [Research] button on the daemon dashboard run Rom's problem-variability review as a direct prompt via the new `runPrompt()` path, which honors await gates (showChoices/showMultiSelect) but skips the scope/build scaffolding. The "what" defaults to `this PR`.
