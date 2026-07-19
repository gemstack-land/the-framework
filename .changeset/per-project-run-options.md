---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

Run options default per project instead of globally. They lived in one `Preferences` object shared by every registered project, so the model you picked for a TypeScript monorepo silently followed you into a scratch prototype. A project now stores only the options it overrides, in a `projectPreferences` block keyed by project id, and anything it does not set still falls through to the global object. Choosing an option while a project is open sets it for that project; the user-level ones (theme, editor, notifications, saved presets) and the consumption limits stay global, as does everything chosen from the Overview. Existing registries read and behave exactly as before until something is overridden.
