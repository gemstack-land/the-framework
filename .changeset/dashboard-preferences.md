---
'@gemstack/framework': minor
---

Persist the dashboard's Global options (Autopilot, Technical, Vanilla, Eco) in the same `the-framework.json` as the project list, read and written daemon-side over Telefunc (`onPreferences` / `savePreferences`), so they survive restarts without localStorage (#410). The registry file becomes an object `{ projects, preferences }`; older bare-array files still read and are migrated on the next write.
