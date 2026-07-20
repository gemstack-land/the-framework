---
'@gemstack/framework': minor
---

A session's answers now come back to the Discord channel that asked for them. Until now the bot acknowledged a message and nothing else followed, so you could talk to an agent from Discord but had to open the dashboard to read what it said. The bot binds a run to the channel it was addressed from, and a watcher posts each new agent turn there as it lands, reusing the committed conversation as the source since that holds the settled reply rather than raw console output. Binding adopts whatever the session has already said, so attaching to a long-running session never replays its backlog into a channel, and while the bot is switched off the cursor still advances, so turning it on starts from now rather than flushing everything said meanwhile. A run nobody addressed from Discord is not mirrored at all.
