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
console.log(run.usage)         // aggregate token usage across dispatched subtasks
console.log(run.stoppedEarly)  // true if a guardrail trimmed or halted work
```

## Pieces are pluggable

Each stage is a plain function, so you mix LLM and deterministic logic freely:

- **`plan`** — a `Planner`: `(task) => Subtask[]`. Use `agentPlanner(agent)` for LLM decomposition, or return a static list.
- **`workers`** — a single `Agent` (all subtasks), a `Record<string, Agent>` (routed by `subtask.worker`), or a `WorkerRouter` function.
- **`synthesize`** — a `Synthesizer`: `(task, results) => string`. Defaults to `defaultSynthesize` (concatenate successes, no LLM call); pass `agentSynthesizer(agent)` for an LLM pass.

## Personas — the stack-aware layer

The Supervisor is stack-agnostic. **Personas** add the opinionated knowledge that
makes autopilot know the GemStack stack (Vike + universal-orm) instead of
guessing. A persona is *data*: a name, a one-line role, a system-prompt fragment,
and the skills/tools it brings (composed over [`@gemstack/ai-skills`](https://github.com/gemstack-land/gemstack/tree/main/packages/ai-skills)).

Three are built in: `vikePageBuilder` (Vike `+` file conventions, renderer-agnostic),
`universalOrmModeler` (schema-first data, derived migrations), and
`uiIntentDesigner` — the "declare intent, decouple implementation" guardrail that
expresses UI as intent so an AI can't hardcode the wrong markup.

```ts
import { Supervisor, agentPlanner } from '@gemstack/ai-autopilot'
import { stackPersonas, personaWorkers, personaRoster } from '@gemstack/ai-autopilot'

const supervisor = new Supervisor({
  // Tell the planner which personas exist so it tags each subtask's `worker`.
  plan: agentPlanner(agent(`Decompose the task.\n\n${personaRoster(stackPersonas)}`)),
  // Materialize the personas into a worker pool keyed by name.
  workers: personaWorkers(stackPersonas, { model: 'anthropic/claude-sonnet-4-5' }),
})

await supervisor.run('Add a paginated orders page backed by an orders table')
```

Define your own with `definePersona({ name, role, systemPrompt, skills?, tools? })`,
or materialize a single persona into an agent with `personaAgent(persona)`. Because
a persona is data, it can be inspected and listed without building an agent first.

## Runner — the pluggable execution seam

Autopilot builds and runs an app somewhere. A **`Runner`** boots an isolated
workspace (a virtual filesystem + a shell + an optional preview URL) and is
shaped after Flue's `sandbox` contract, so real sandboxes drop in behind one
interface: **WebContainer** (instant in-browser Vike preview), a **Docker**
sandbox on our servers, or a **Flue** sandbox (in-memory / edge / container). We
sit on those harnesses rather than competing with them.

This package ships the interface plus a **`FakeRunner`** (the runner analog of
`ai-sdk`'s `AiFake`) so autopilot can be driven and tested without any sandbox
infra. Real adapters land as separate packages.

```ts
import { FakeRunner, runnerTools } from '@gemstack/ai-autopilot'
import { personaAgent, vikePageBuilder } from '@gemstack/ai-autopilot'

const runner = new FakeRunner()
const session = await runner.boot({ files: { 'pages/+config.js': '…' } })

// Give a persona hands inside the sandbox: read/write files, exec, preview.
const agent = personaAgent(vikePageBuilder, { model: 'anthropic/claude-sonnet-4-5' })
const withTools = agent // compose runnerTools(session) into its tools()

await session.exec('pnpm build')
const { url } = (await session.preview?.({ port: 5173 })) ?? {}
```

`runnerTools(session)` exposes the session to an agent as `ai-sdk` tools
(`read_file`, `write_file`, `list_files`, `exec`, and — only when the session
supports it — `preview`). Toggle `write` / `exec` for a read-only surface, or set
a `prefix` to avoid name collisions.

To implement a real runner, satisfy the `Runner` interface: `boot()` returns a
`RunnerSession` with an `fs`, `exec()`, an optional `preview()`, and `dispose()`.

## Surfaces — terminal, in-page, background

The Supervisor already emits progress via `onEvent`. **Surfaces** run the same
autopilot in three places by adapting that event stream:

**Terminal** — print each event inline:

```ts
import { Supervisor, terminalSink } from '@gemstack/ai-autopilot'

const supervisor = new Supervisor({ ...opts, onEvent: terminalSink() })
await supervisor.run(task)
// ▶ plan: 2 subtask(s) for "…"
//   → s1: …
//   ✓ s1
//   ▶ synthesize: 2 result(s)
```

**Background** — launch detached and get a handle; nothing blocks:

```ts
import { launchAutopilot } from '@gemstack/ai-autopilot'

const run = launchAutopilot(onEvent => new Supervisor({ ...opts, onEvent }).run(task))
run.status()        // 'running' → 'done' | 'error'
run.events(offset)  // replay history from an offset (Flue-style tail=N)
const result = await run.result()
```

**In-page** — the same handle exposes a live async stream to push over SSE:

```ts
for await (const event of run.stream()) sendToClient(event)  // replays history, then live, then ends
```

`EventStream` is the underlying replayable, multi-consumer transport; a late
subscriber still sees the full history. Use `formatEvent(event)` to render an
event as a line yourself.

## Guardrails

- **`concurrency`** (optional, default 4) — max workers in flight; positive integer.
- **`maxSubtasks`** (optional) — hard cap; a longer plan is trimmed and `stoppedEarly` is set. Omit for no cap.
- **`budget.maxTotalTokens`** (optional) — stop dispatching once aggregate dispatch usage crosses the limit (in-flight workers finish; remaining subtasks are skipped). Omit for no limit.
- **Error isolation** — a worker that throws becomes an `ok: false` result; siblings continue.
- **Observer safety** — an `onEvent` callback that throws is logged and swallowed; it never aborts the run.

`Supervisor` validates its options at construction (`plan`, `workers`, positive `concurrency` / `maxSubtasks`), and `run()` rejects an empty task, so misconfiguration fails fast with a clear message.

## Scope (what's deferred)

The seed dispatches **autonomous** workers via `agent.prompt()`. A worker that pauses for a client-tool or approval round-trip is reported as a failed subtask — durable pause/resume across a supervised run (building on `ai-sdk`'s `SubAgentRunStore` + resume primitives) is a deferred adapter, as are other topologies (pipelines, debate) and queue-backed long-running execution. Those land on demand, behind optional seams, not in the core.

## License

MIT
