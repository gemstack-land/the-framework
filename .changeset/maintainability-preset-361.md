---
'@gemstack/framework': minor
---

New [Maintainability] preset button on the dashboard (#361): prefills the deliberately minimal refactor-for-future-changes prompt ("look for maintainability red flags, and fix them") into the start textarea for review or editing; Start runs the text verbatim as a direct prompt run. The one blank, `<PARAM:what>`, defaults to `this PR`.
