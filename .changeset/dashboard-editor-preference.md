---
'@gemstack/framework': minor
---

Add a preferred-editor dashboard preference (#727). "Open in editor" now uses a stored `editor` preference (an editor CLI such as `code`, `cursor`, or `zed`), falling back to `$FRAMEWORK_EDITOR` and then `code` as before. The Settings gear offers a picker that auto-detects the editors installed on the daemon's machine by probing their launchers on PATH (`onEditors`), plus a "Default" entry to clear the choice. A public host, which has no local checkout to open, detects nothing.
