---
'@gemstack/ai-autopilot': minor
'@gemstack/framework': minor
---

Architect stack rationale: PROS/CONS + alternatives considered

The web dashboard's edge over the CLI is showing *why* the AI chose the stack. The architect step now returns that rationale, not just a one-line why:

- `ArchitectPlan` gains optional `pros`, `cons`, and `alternatives` (`{option, whyNot}`). The `agentArchitect` (ai-sdk) and `driverArchitect` (framework) both ask for them and parse them; absent fields are omitted, so existing producers are unaffected.
- A new exported `STACK_TRADEOFFS` block gives the architect objective, reusable Vike-vs-Next reasons (edge/Cloudflare deploy, renderer-agnostic, ecosystem size) so the justification is grounded rather than invented per run. Both architect prompts embed it.
- The `Bootstrap` orchestrator emits `pros`/`cons`/`alternatives` on the `architect` event and records the rejected alternatives to the decisions ledger as rejections, so the ledger shows what was weighed.
- The framework dashboard's "Stack & rationale" panel renders the pros, cons, and "Considered instead" alternatives. The `--fake` demo populates them.

Part of #209. Closes #210.
