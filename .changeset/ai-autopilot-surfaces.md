---
"@gemstack/ai-autopilot": minor
---

Add surfaces: run the same autopilot in the terminal, an in-page UI, or a background process, all over the Supervisor's `onEvent` stream. `terminalSink()` prints events inline (`formatEvent()` renders one event as a line); `EventStream` is a replayable multi-consumer transport with offset/tail replay (borrowing Flue's Durable-Streams `tail=N`); `launchAutopilot(start)` runs a Supervisor detached and returns an `AutopilotHandle` (`status()`, `events(offset)`, live async `stream()`, `result()`) that backs both the background and in-page (SSE) surfaces. Verified end-to-end against a real Supervisor. Closes the surfaces child (#100) of the ai-autopilot epic (#97).
