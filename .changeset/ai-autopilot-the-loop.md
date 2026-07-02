---
"@gemstack/ai-autopilot": minor
---

Add "the loop": the event-to-prompt-chain policy. The agent declares a semantic `LoopEvent` (a change `kind`) and the matching prompt chain fires: a major change runs review + code-quality + security, a new UI flow runs QA + UX. `Loop.handle(event)` resolves the chain from `LoopRule`s (`defineRule` / `defaultLoopRules()` as the built-in policy) and runs each `LoopPrompt` (`definePrompt`) for its `passes` with fresh context every pass; `matches(event)` is the pure preview, `watch(stream)` handles a stream fire-and-report. Design calls on the two open questions: the trigger is agent-declared (not heuristic), and both modes ship (`handle` awaits; `continueOnError: false` is a blocking gate). Consults the decisions ledger via `ctx.ledger`, and references the prompts library (#111) by id. Verified end-to-end. Child #113 of the AI-framework epic (#110).
