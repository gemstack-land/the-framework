---
"@gemstack/ai-autopilot": minor
---

Add the `production-grade` checklist prompt and a `{ blockers }` verdict convention. The new built-in prompt judges an app against a production-grade checklist (auth, data layer, error handling, instrumentation, emailing, validation, tests, build/config) and ends with a machine-readable `{ "blockers": [...] }` verdict — an empty list means production-grade. `parseVerdict()` / `isPassing()` read it back, and the loop now gates on that outcome: a `PromptOutcome` carries `verdict` and a `passing` flag (executed *and* no blockers), and `continueOnError: false` stops the chain on `!passing`. Backward compatible — with no verdict reported, `passing === ok`; pass `verdict: null` for an execution-only gate. This is what bootstrap's full-fledged loop repeats against until blockers is empty. Closes #121.
