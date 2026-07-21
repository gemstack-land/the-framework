---
'@gemstack/framework': patch
---

An agent that names its session "view" is no longer silently ignored (#939)

slugify's empty-slug fallback was the literal sentinel `view`, and parseSessionName rejected that
sentinel, so a legitimate `View` in a set-session-name block was indistinguishable from no name
and the rename was dropped. slugify now takes its fallback explicitly: parseSessionName tests for
emptiness, and the `view` fallback stays local to the markdown-view ids where it belongs.
