---
'@gemstack/framework': minor
---

Chat to The Framework from Discord (#680)

Discord was outbound-only: the daemon posts a webhook message when something needs you (#627), but
a webhook cannot read a reply, so answering meant leaving Discord and opening the dashboard.

The daemon now runs a Discord bot. Message it and it starts a session; message it again while that
session is running and the text reaches the run through the same control channel the dashboard's
live chat uses (#714). When a run parks on a question, the bot posts the numbered options and a
reply of `2` answers it. `!status`, `!stop` and `!help` do what they say. `Ctrl+C` takes the bot
offline with the rest of the daemon.

Chat history goes where #857 asked for it: a message routed into a run lands in that run's
conversation under `.the-framework/conversations/` (#908), committed with the repo. Nothing about
the chat is stored outside git.

Two gates, mirroring the notification watchers: a `DISCORD_BOT_TOKEN` (how to connect) and the new
`discordBot` preference (whether to), read per message so the toggle applies without a restart.
Both absent by default — unlike a notification, this one acts on what it reads. Set
`DISCORD_CHANNEL_ID` to confine it to one channel.

The gateway client is hand-rolled over node's global `WebSocket` rather than adding `discord.js`,
keeping the package's three runtime dependencies intact, and reconnects with exponential backoff so
a refused connection never becomes a tight loop.
