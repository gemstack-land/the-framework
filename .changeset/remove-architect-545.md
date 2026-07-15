---
'@gemstack/framework': minor
'@gemstack/ai-autopilot': minor
---

Remove the architect. A build no longer runs a turn to pick the app's stack, and no longer tells the agent what to build on: the agent reads the workspace and decides for itself, the same way it would outside The Framework. `buildPrompt` / `extendPrompt` / `scaffoldPrompt` now take just the intent and say nothing about a stack.

Being opinionated about the stack is a hard thing to do well, and a system prompt that nudges one is worse than none at all (#545). The stack guidance we had was not designed, it accumulated. It goes rather than half-ships.

Gone with it, because the architect was their only source:

- the plan-approval gate ("Approve this plan?" / "Use X instead") and re-architect. The agent-authored await gates a build turn raises are unaffected: a build that stops to ask still pauses the run with Approve / Decline.
- the decisions ledger in a run, and the `DECISIONS.md` a run wrote from it. `@gemstack/ai-autopilot`'s `decisions/` module is untouched and still exported; nothing in a run feeds it now.
- the dashboard's "Stack & rationale" and "Decisions ledger" panels. Loop status, deploy, and session cards are unchanged.
- `@gemstack/ai-autopilot`: `agentArchitect`, `STACK_TRADEOFFS`, `BootstrapSteps.architect`, `BootstrapOptions.ledger`, the `architect` bootstrap event, `ArchitectPlan` / `ArchitectContext` / `ArchitectDecision` / `ArchitectAlternative`, and the `plan` field on the build / loop / deploy contexts and on `BootstrapResult`. The flow is now scope -> build -> loop -> deploy.
- `@gemstack/framework`: `driverArchitect`, `reArchitect`, `architectPrompt`, `parseArchitectPlan`, `architectPlan`, `decisionLedger`, `RunFrameworkResult.ledger`, and the `bench:architect` benchmark.
