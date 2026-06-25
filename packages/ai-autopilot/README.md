# @gemstack/ai-autopilot

Orchestration for [`@gemstack/ai-sdk`](https://github.com/gemstack-land/gemstack/tree/main/packages/ai-sdk) agents — the "director" layer that runs **many** agent runs under a control policy.

`ai-sdk` owns the single-agent loop and the handoff / subagent primitives. `ai-autopilot` owns orchestrating multiple runs: which agents run, in what order, how their results combine, and when to stop. If a feature is just calling an `ai-sdk` primitive, it belongs in `ai-sdk` — autopilot earns its keep only as the topology / control-policy layer.

## The seed: Supervisor (plan → dispatch → synthesize)

The first slice is the supervisor/worker topology — the smallest thing clearly more than the primitives:

1. **Plan** — a planner decomposes the task into subtasks.
2. **Dispatch** — each subtask runs on a worker agent, with bounded concurrency, an optional token budget, and per-subtask error isolation.
3. **Synthesize** — a synthesizer combines the results into the final answer.

```ts
import { Supervisor, agentPlanner, agentSynthesizer } from '@gemstack/ai-autopilot'

const supervisor = new Supervisor({
  plan: agentPlanner(plannerAgent),                       // LLM decomposition
  workers: { research: researchAgent, write: writerAgent }, // routed by subtask.worker
  synthesize: agentSynthesizer(editorAgent),              // LLM synthesis
  concurrency: 3,
  maxSubtasks: 8,
  budget: { maxTotalTokens: 200_000 },
  onEvent: (e) => console.log(e.type),
})

const run = await supervisor.run('Draft a launch brief for product X')
console.log(run.text)          // synthesized answer
console.log(run.results)       // per-subtask outcomes (ok / error / usage)
console.log(run.usage)         // aggregate token usage
console.log(run.stoppedEarly)  // true if a guardrail trimmed or halted work
```

## Pieces are pluggable

Each stage is a plain function, so you mix LLM and deterministic logic freely:

- **`plan`** — a `Planner`: `(task) => Subtask[]`. Use `agentPlanner(agent)` for LLM decomposition, or return a static list.
- **`workers`** — a single `Agent` (all subtasks), a `Record<string, Agent>` (routed by `subtask.worker`), or a `WorkerRouter` function.
- **`synthesize`** — a `Synthesizer`: `(task, results) => string`. Defaults to `defaultSynthesize` (concatenate successes, no LLM call); pass `agentSynthesizer(agent)` for an LLM pass.

## Guardrails

- **`concurrency`** (default 4) — max workers in flight.
- **`maxSubtasks`** — hard cap; a longer plan is trimmed and `stoppedEarly` is set.
- **`budget.maxTotalTokens`** — stop dispatching once aggregate usage crosses the limit (in-flight workers finish; remaining subtasks are skipped).
- **Error isolation** — a worker that throws becomes an `ok: false` result; siblings continue.

## Scope (what's deferred)

The seed dispatches **autonomous** workers via `agent.prompt()`. A worker that pauses for a client-tool or approval round-trip is reported as a failed subtask — durable pause/resume across a supervised run (building on `ai-sdk`'s `SubAgentRunStore` + resume primitives) is a deferred adapter, as are other topologies (pipelines, debate) and queue-backed long-running execution. Those land on demand, behind optional seams, not in the core.

## License

MIT
