---
'@gemstack/framework': minor
---

Add a Project log panel to the dashboard (#384). It surfaces the committed `.the-framework/LOGS.md` history (#378/#379) for the workspace: every loop/prompt/build run with its title, status, kind, session link, and a loop's constituent prompts, newest-first. Served by a new `GET /api/logs` endpoint and refreshed on load, on run-end, and on an interval. All fields are escaped and the session link is passed through the page's safe-URL guard, since the log is agent-authored.
