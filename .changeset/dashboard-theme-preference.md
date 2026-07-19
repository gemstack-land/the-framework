---
'@gemstack/framework': minor
---

Add a `theme` dashboard preference (#725): `system` (the default, following the OS), `light`, or `dark`. Stored in `the-framework.json` alongside the other preferences and sanitized against the known set. The dashboard applies it by toggling the `.dark` class (following live OS changes while on `system`) and exposes a system/light/dark picker in the Settings gear, replacing the previously hardcoded dark-only mode.
