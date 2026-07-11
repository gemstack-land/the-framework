---
'@gemstack/framework': patch
---

Architect turns now honor agent-authored await gates (#356): an architect (or re-architect) turn that stops to ask via `showChoices()` / `showMultiSelect()` resolves through the live dashboard gate and re-prompts with the answer, instead of the question being silently swallowed into a stub fallback plan at the plan-approval gate. Headless runs are unchanged. Bounded at 5 rounds, like the build gate.
