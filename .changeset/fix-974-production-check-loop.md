---
'@gemstack/ai-autopilot': minor
---

The bootstrap checklist's default event kind now resolves against `defaultLoops()` (#974)

`loopChecklist` fires `production-check` by default, but `defaultLoops()` only defined
`major-change` and `ui-flow`. The event matched no loop, so the checklist never saw a
`production-grade` verdict, treated the missing verdict as a blocker, and
`BootstrapResult.productionGrade` could never be `true` on the documented default path.
Every caller had to hand-write the missing loop.

`LOOP_EVENTS` gains `productionCheck: 'production-check'` and `defaultLoops()` now returns a
third loop, `production-check -> [production-grade]`. The shipped `production-grade` prompt
declares that event too, so `library.byEvent('production-check')` returns it.

Behaviour change for anyone spreading `defaultLoops()`: the returned array now has three
entries instead of two, and an event of kind `production-check` that previously fell through
as unmatched now runs the `production-grade` prompt. If you already added your own
`production-check` loop, both fire and the prompt ids are de-duped across matching loops, so
the chain is unchanged. To keep the old policy, filter the gate out.
