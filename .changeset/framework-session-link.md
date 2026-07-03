---
'@gemstack/framework': minor
---

Surface the live agent session on the dashboard. The wrapped agent's real session id is captured once the first turn returns and streamed as a new `session-update` event, so the dashboard header shows the live session (and the terminal prints it). `--session-link` now accepts a `{sessionId}` template that resolves to a real URL once the id is known; a literal URL still shows immediately.
