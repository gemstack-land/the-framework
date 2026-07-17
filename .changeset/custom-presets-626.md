---
'@gemstack/framework': minor
---

Custom presets (#626): save your own prompts as reusable presets beside the built-in ones. A "＋ Preset" button under the prompt textarea captures the current editor text (or a fresh one) under a name; saved presets render as buttons that load their prompt back into the editor, and each has a delete. They persist in the daemon preferences (`customPresets`), sanitized and capped so a hand-edited registry can't bloat the home file. For the users (Rom, nitedani) who keep hand-crafting high-signal prompts, this makes them one click to re-run.
