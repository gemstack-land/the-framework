---
'@gemstack/framework': minor
---

A committed conversation now records the surface each turn came through, so a chat held in Discord reads as `discord` instead of being filed under the dashboard. The control channel's message entries carry an optional origin, the run attributes each turn to it, and an agent's reply inherits the origin of the message it answers, so a question and its answer stay one exchange. A run the daemon starts on a surface's behalf is tagged with `--via`, which keeps a chat-started session's opening turn from being attributed to the wrong place. Turns that name no surface fall back to the local one exactly as before, and entries written before this still parse. Transport names are validated where they enter, since they are written into a line-parsed conversation heading and a forged one could otherwise fake a turn.
