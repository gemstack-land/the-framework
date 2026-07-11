---
'@gemstack/framework': minor
---

Dashboard presets only prefill the textarea (#353): the [Research] button now loads the full rendered preset prompt for review and editing, and nothing runs until Start / Ctrl+Enter. The edited text is sent verbatim via a new `prompt` start kind and `framework prompt <text>` subcommand (the direct path: gates honored, no build pipeline). Clearing the box reverts Start to a normal build run.
