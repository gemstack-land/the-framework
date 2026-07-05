---
'@gemstack/framework': minor
'@gemstack/ai-autopilot': minor
---

The domain loop drives the production-grade review phase (#252).

When a run has a domain preset, its review loop now *replaces* the built-in
checklist: each pass dispatches a `major-change` event through the preset's
driver-backed loop, so its review chain (e.g. code review, test coverage, security
review) fires through the wrapped agent, and Bootstrap's pass / improve / maxPasses
machinery gates on the union of the `{ blockers }` verdicts the chain reports. A
preset with no loop for the build event falls back to the built-in checklist, so a
run is never left unreviewed. New: `domainLoopChecklist` + `verdictFromLoopRun`
(@gemstack/framework).

The shipped Software Development preset's review prompts (code review, test
coverage, security review) now end with a `{ blockers }` verdict so the loop
actually gates rather than only running.
