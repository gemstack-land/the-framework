---
"@gemstack/ai-autopilot": minor
---

Initial release. Orchestration for `@gemstack/ai-sdk` agents — the control-policy layer over many agent runs. Seed slice: the supervisor/worker topology.

- `Supervisor` — **plan → dispatch → synthesize**: decompose a task into subtasks, dispatch each to a worker agent (bounded concurrency, optional token budget, per-subtask error isolation), and synthesize the results.
- `agentPlanner(agent)` — turn a planning agent into a `Planner` via `ai-sdk`'s `Output.array` (JSON subtask decomposition).
- `agentSynthesizer(agent)` / `defaultSynthesize` — combine subtask results (LLM pass, or deterministic concatenation).
- Pluggable stages (`plan` / `workers` / `synthesize`), guardrails (`concurrency`, `maxSubtasks`, `budget.maxTotalTokens`), and progress events.

Scope boundary: `ai-sdk` owns the single-agent loop + handoff/subagent primitives; `ai-autopilot` owns orchestrating multiple runs under a policy. The seed runs autonomous workers; durable pause/resume, more topologies, and queue-backed execution are deferred behind optional seams. Depends on `@gemstack/ai-sdk`.
