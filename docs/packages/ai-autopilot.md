# @gemstack/ai-autopilot

Orchestration for [`@gemstack/ai-sdk`](/packages/ai-sdk/) agents: the "director" layer that runs **many** agent runs under a control policy.

`ai-sdk` owns the single-agent loop and the handoff / subagent primitives. `ai-autopilot` owns orchestrating multiple runs: which agents run, in what order, how their results combine, and when to stop. Anything that is just a call to an `ai-sdk` primitive belongs in `ai-sdk`; this package adds value as the topology and control-policy layer on top.

```bash
pnpm add @gemstack/ai-autopilot @gemstack/ai-sdk
```

## The framework layers

The Supervisor (below) is the seed topology. Built up from it, the package is a full framework for building software with agents — the state layer and the loop are the moat, not the prompts:

- **Personas + presets** — reusable, stack-aware roles materialized into worker agents; `presetPersonas` selects the framework-specific ones (Vike flagship, Next.js) by detecting the project's framework, on top of a framework-neutral core.
- **Runner** — a pluggable sandbox seam (`FakeRunner` + a real `LocalRunner`) where agents build and run an app; expose it to an agent with `runnerTools`.
- **Surfaces** — the same run in a terminal, an in-page UI, or a detached background handle, over one replayable event stream (`launchAutopilot`).
- **Decisions ledger** — durable memory of rejected ideas + settled choices (round-trips `DECISIONS.md`) so a run stops re-pitching what was turned down.
- **The loop** — an event-to-prompt-chain policy (a major change fires review + code-quality + security; a new UI flow fires QA + UX), gating on a `{ blockers }` verdict, with a data-driven built-in **prompt library**.
- **Bootstrap** — the spine that sequences all of the above into scope → build → full-fledged loop → deploy, taking an app from nothing to production-grade.
- **Scale mode** — a self-maintaining `CODE-OVERVIEW.md`, refreshed only on material change.

See [`examples/bootstrap-quickstart`](https://github.com/gemstack-land/gemstack/tree/main/examples/bootstrap-quickstart) for all of it wired together offline.

## Supervisor (plan, dispatch, synthesize)

The supervisor/worker topology is the first orchestration shape this package ships:

1. **Plan** - a planner decomposes the task into subtasks.
2. **Dispatch** - each subtask runs on a worker agent, with bounded concurrency, an optional token budget, and per-subtask error isolation.
3. **Synthesize** - a synthesizer combines the results into the final answer.

```ts
import { Supervisor, agentPlanner, agentSynthesizer } from '@gemstack/ai-autopilot'

const supervisor = new Supervisor({
  plan: agentPlanner(plannerAgent),                          // LLM decomposition
  workers: { research: researchAgent, write: writerAgent },  // routed by subtask.worker
  synthesize: agentSynthesizer(editorAgent),                 // LLM synthesis
  concurrency: 3,
  maxSubtasks: 8,
  budget: { maxTotalTokens: 200_000 },
  onEvent: (e) => console.log(e.type),
})

const run = await supervisor.run('Draft a launch brief for product X')
console.log(run.text)          // synthesized answer
console.log(run.results)       // per-subtask outcomes (ok / error / usage)
console.log(run.usage)         // aggregate token usage across dispatched subtasks
console.log(run.stoppedEarly)  // true if a guardrail trimmed or halted work
```

`Supervisor` validates its options at construction (`plan`, `workers`, positive `concurrency` / `maxSubtasks`), and `run()` rejects an empty task, so misconfiguration fails fast with a clear message.

## Pieces are pluggable

Each stage is a plain function, so you mix LLM and deterministic logic freely:

- **`plan`** - a `Planner`: `(task) => Subtask[]`. Use `agentPlanner(agent)` for LLM decomposition, or return a static list (or any hand-rolled logic).
- **`workers`** - a single `Agent` (every subtask runs on it), a `Record<string, Agent>` (routed by `subtask.worker`), or a `WorkerRouter` function for full control.
- **`synthesize`** - a `Synthesizer`: `(task, results) => string`. Defaults to `defaultSynthesize` (concatenate the successful results, no LLM call); pass `agentSynthesizer(agent)` for an LLM pass.

`agentPlanner` and `agentSynthesizer` are the two adapters that turn an `ai-sdk` [agent](/packages/ai-sdk/agents) into a `Planner` / `Synthesizer`; everything else can be ordinary code.

## Guardrails

| Guardrail | Default | Effect |
|---|---|---|
| `concurrency` | `4` | Max workers in flight; positive integer. |
| `maxSubtasks` | none | Hard cap. A longer plan is trimmed and `stoppedEarly` is set. Omit for no cap. |
| `budget.maxTotalTokens` | none | Stop dispatching once aggregate dispatch usage crosses the limit. In-flight workers finish (usage can overshoot slightly); remaining subtasks are skipped. Omit for no limit. |

Two further safety properties hold without configuration:

- **Error isolation** - a worker that throws becomes an `ok: false` result; siblings continue.
- **Observer safety** - an `onEvent` callback that throws is logged and swallowed; it never aborts the run.

Progress is reported through `onEvent` as typed `SupervisorEvent`s (`plan`, `plan-trimmed`, `dispatch-start`, `dispatch-result`, `budget-exceeded`, `synthesize`).

## The run result

`supervisor.run(task)` resolves to a `SupervisorRun`:

| Field | Type | Meaning |
|---|---|---|
| `text` | `string` | The synthesized final answer. |
| `plan` | `PlannedSubtask[]` | The plan that was executed (after any guardrail trimming). |
| `results` | `SubtaskResult[]` | One result per dispatched subtask, in plan order. Each carries `text`, `ok`, optional `error`, and `usage`. |
| `usage` | `TokenUsage` | Aggregate token usage across the dispatched subtasks (planning and synthesis spend are not included, since the `Planner` / `Synthesizer` contracts return data, not usage). |
| `stoppedEarly` | `boolean` | True when a guardrail (subtask cap or token budget) stopped work early. |

## Scope (what's deferred)

The supervisor dispatches **autonomous** workers via `agent.prompt()`. A worker that pauses for a client-tool or approval round-trip is reported as a failed subtask. Durable pause/resume across a supervised run (building on `ai-sdk`'s `SubAgentRunStore` and resume primitives) is a deferred adapter, as are other topologies (pipelines, debate). Real sandboxed runner adapters (Docker / WebContainer / Flue) and live end-to-end bootstrap verification are infra-gated — the framework verifies offline against `FakeRunner` + a scripted model. Those land behind optional seams, not in the core.

## See also

- [Agents](/packages/ai-sdk/agents) - the single-agent loop the supervisor dispatches to.
- [Build a Multi-Agent App](/guide/tutorial) - the Supervisor wired up end to end.
