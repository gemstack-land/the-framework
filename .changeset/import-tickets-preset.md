---
'@gemstack/framework': minor
'@gemstack/framework-dashboard': minor
---

New preset: Import tickets from GitHub, and it always opens a session of its own (#959)

The triage and planning presets all read `tickets/`, so a repo with an empty one has nothing
for them to work from. This fills it from the repo's GitHub issues.

It is the first preset marked `newSession`. Loaded from inside a session, every other preset
is a message to that session; this one is not about the conversation at all, and appending it
would put the import on that session's branch, behind its context. So both in-session
composers send it as a new run instead, and the view follows it.
