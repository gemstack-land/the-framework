---
'@gemstack/framework': minor
---

Default the live-run session link to claude.ai/code

A live run now shows a session link to `https://claude.ai/code` by default (the page where a Claude Code session appears once Remote Control is enabled), so the dashboard points somewhere useful without needing `--session-link`. `--fake` gets no link (it has no real session), and an explicit `--session-link` still wins — including the `{sessionId}` template, which is filled in with the real Claude session id once known.

Why not a per-session deep link: we drive Claude Code headless, and Remote Control (which powers the claude.ai/code session view) is opt-in and subscription-gated, so there is no session-URL slug to construct. The session id is already surfaced on the dashboard and in the CLI narration; the README's new "Watching the live session" section documents the Remote Control path. New exports: `chooseSessionLink`, `CLAUDE_CODE_SESSION_LIST`.

Part of #209. Closes #212.
