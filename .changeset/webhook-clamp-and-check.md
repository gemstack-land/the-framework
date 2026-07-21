---
'@gemstack/framework': patch
---

Discord webhook posts are clamped to the 2000-char limit and failures are logged (#940)

The notification posters (activity, needs-you interventions) sent whatever content they built and
never looked at the response. Discord rejects a message over 2000 chars with a 400, so a long
needs-you batch silently posted nothing. The shared webhook transport now clamps with the same
helper the bot API uses, resolves whether Discord accepted the post, and the daemon logs a failed
delivery like its other failures.
