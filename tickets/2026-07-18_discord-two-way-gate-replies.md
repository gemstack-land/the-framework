# Two-way Discord replies to answer awaiting-gates

## TLDR

Answer an awaiting-gate (pick a choice, approve a merge) directly from a Discord reply, so the human-intervention queue is chat-native instead of dashboard-only.

## Why it matters

Discord notifications (#627) are outbound-only today: a plain webhook `POST` of `{ content }` when a run needs attention (an `await`/`showChoices()` gate, or a ready-to-merge run). To actually answer that gate — pick a choice, approve a merge — the user still has to leave Discord and open the dashboard. For anyone who lives in chat day-to-day (the explicit motivation behind #606's "agents as teammates in the comms layer"), that round-trip is the friction that keeps the human-intervention queue (#624) from being a true chat-native workflow.

This is a deliberately small slice of that bigger collaboration-layer epic (#606) — it does not need the daemon/gateway split (#605) or channel-presence/manager-agent work #606 describes. It only needs the run to be resumable from an out-of-band answer, which the existing control-channel (`.the-framework/control.jsonl`, `watchControl()`, #313) already supports for the dashboard's own choice UI.

## Rough shape

- Switch the Discord integration from a plain incoming webhook to a minimal bot (needed to *read* replies, which incoming webhooks can't do) — or, as a lighter first cut, require the user to react/reply in the same thread the notification posted to, polled via the webhook channel's message history.
- Notification message includes the numbered options exactly as `showChoices()`/`showMultiSelect()` would render them in the dashboard, plus the run/project id.
- A reply like `2` or `merge` in that thread resolves to a control-channel write (`appendControl()` or whatever `watchControl()` consumes) equivalent to clicking that same choice in `ChoicesRail`/`NeedsYou` — same code path, different input surface.
- Scope to the two gate kinds already modeled: `awaiting` (a choice pick) and ready-to-merge (approve/merge). No open-ended chat, no @mentioning agents — that's #606's job.
- Setting: reuse the existing per-user `notifyDiscord` toggle (#627); two-way is opt-in on top of that, since it requires a bot token instead of just a webhook URL.

## Related

- #627 (Notifications / Discord) — the outbound half this extends into two-way.
- #606 (Collaboration layer epic) — the long-term direction; this ticket is an intentionally small, standalone slice that doesn't wait on #605/#606's daemon+gateway prerequisite.
- #624 (Queue) — what a Discord reply is actually resolving.
