---
'@gemstack/framework': minor
---

feat(framework): turn an agent's showChoices()+AWAIT into a live gate at the turn boundary (#337)

The system prompt tells the agent to `showChoices()` and `AWAIT` at unclear-scope / alternatives points, but until now only framework-emitted gates (the plan-approval gate, multi-select) could pause a run. Now when a build turn ends by asking the user, an `await-choices` block, the framework shows the choice on the dashboard, waits for the pick, and re-prompts the agent to continue from that decision. It is the agent-authored counterpart to the plan-approval gate: a no-op when headless and when the agent just finishes instead of asking, so existing runs are unchanged.
