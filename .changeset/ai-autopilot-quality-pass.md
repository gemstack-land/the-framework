---
"@gemstack/ai-autopilot": patch
---

Quality + docs pass for ai-autopilot:

- `Supervisor` now validates its options at construction (`plan` must be a function, `workers` is required, `concurrency`/`maxSubtasks` must be positive integers) and `run()` rejects an empty task, so misconfiguration fails fast with a clear message instead of deep in a planner call.
- An `onEvent` callback that throws is now isolated (logged and swallowed) so an observer bug can no longer abort a supervised run.
- Corrected the `SupervisorRun.usage` docs: it aggregates dispatched-subtask usage only (the `Planner`/`Synthesizer` contracts return data, not usage, so planning/synthesis spend isn't observable).
- Clarified that `maxSubtasks` and `budget` are optional, marked the internal `runPool` helper `@internal`, and added JSDoc examples.
