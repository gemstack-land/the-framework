---
"@gemstack/framework": minor
---

Live chat: send more messages to a running run. The dashboard's run view gains a composer, and the run stays open after the agent goes idle to take the user's own messages (the "stay-open" lifecycle) until it is stopped. Each message continues the same agent session via `claude --resume <sessionId>`, so the conversation keeps full context, and rides the existing `control.jsonl` steering channel as a new `message` kind next to Stop and choice picks. Wired only for an interactive run (a live dashboard / daemon); a headless run ends when the agent stops asking, exactly as before. The Claude Code driver gains a `resume` prompt option (`DriverPromptOptions.resume`) that continues the retained session and skips the redundant system-prompt re-append.
