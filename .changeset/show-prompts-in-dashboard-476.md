---
"@gemstack/framework": minor
---

Show the exact prompt sent to the agent each turn. The run feed used to render a turn's start as just `> prompt sent` and drop the text; now the terminal/log formatter shows a one-line preview, and the dashboard event feed renders the full prompt in a collapsible block (click to expand) for both live runs and replays. The prompt was already carried on the driver `start` event and persisted, so this is a display-only change that surfaces it.
