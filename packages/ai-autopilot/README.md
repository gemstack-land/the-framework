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

## Bring your own agents

The Supervisor is stack-agnostic, and stays that way: you hand it the agents, and
it orchestrates them as-is. Autopilot never appends framing, a role, or knowledge
of its own to an agent's instructions — what you write is the whole system prompt.

```ts
import { Supervisor, agentPlanner } from '@gemstack/ai-autopilot'
import { agent } from '@gemstack/ai-sdk'

const roster = [
  { name: 'data-modeler', role: 'Design database schemas and migrations.' },
  { name: 'page-builder', role: 'Build pages and their routing.' },
]

const supervisor = new Supervisor({
  // Tell the planner which workers exist so it tags each subtask's `worker`.
  plan: agentPlanner(agent(`Decompose the task.\n\n${roster.map(w => `- ${w.name}: ${w.role}`).join('\n')}`)),
  workers: Object.fromEntries(roster.map(w => [w.name, agent({ instructions: w.role })])),
})

await supervisor.run('Add a paginated orders page backed by an orders table')
```

## Runner — the pluggable execution seam

Autopilot builds and runs an app somewhere. A **`Runner`** boots an isolated
workspace (a virtual filesystem + a shell + an optional preview URL) and is
shaped after Flue's `sandbox` contract, so real sandboxes drop in behind one
interface: **WebContainer** (instant in-browser Vike preview), a **Docker**
sandbox on our servers, or a **Flue** sandbox (in-memory / edge / container). We
sit on those harnesses rather than competing with them.

This package ships the interface, a **`FakeRunner`** (the runner analog of
`ai-sdk`'s `AiFake`) so autopilot can be driven and tested without any infra,
and three real adapters that satisfy the same interface: **`LocalRunner`** (a
real temp directory on the host, the reference the sandboxed ones mirror),
**`DockerRunner`** (a container via the `docker` CLI, isolated from the host with
a published preview port), and **`WebContainerRunner`** (an in-browser
WebContainer for an instant Vike preview, nothing touching the host). A **Flue**
adapter (in-memory / edge / container) is the next one behind the same seam.

`LocalRunner` runs commands **unsandboxed on the host**, so reach for it only
where execution is already trusted (local dev, or a CI job that is itself the
sandbox) — not to run untrusted, agent-authored code.

```ts
import { LocalRunner } from '@gemstack/ai-autopilot'

const runner = new LocalRunner()
const session = await runner.boot({ files: { 'app.js': "console.log('hi')" } })
await session.exec('node app.js') // → { stdout: 'hi\n', stderr: '', exitCode: 0 }
await session.dispose()           // removes the temp workspace
```

```ts
import { FakeRunner, runnerTools } from '@gemstack/ai-autopilot'
import { agent } from '@gemstack/ai-sdk'

const runner = new FakeRunner()
const session = await runner.boot({ files: { 'pages/+config.js': '…' } })

// Give an agent hands inside the sandbox: read/write files, exec, preview.
const builder = agent({ instructions: 'Build pages.', tools: runnerTools(session) })

await session.exec('pnpm build')
const { url } = (await session.preview?.({ port: 5173 })) ?? {}
```

`runnerTools(session)` exposes the session to an agent as `ai-sdk` tools
(`read_file`, `write_file`, `remove_file`, `list_files`, `exec`, plus
`start_server` and `preview` only when the session supports them). Toggle
`write` / `exec` for a read-only surface, or set a `prefix` to avoid name
collisions.

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

## Decisions — durable memory (stop re-pitching rejected ideas)

The most felt failure mode of an AI dev tool is re-suggesting the same thing it
already proposed and got turned down. The **decisions ledger** records the
project's rejected ideas and settled choices so a run remembers. It is *data*: it
round-trips a human-editable `DECISIONS.md` you can read and edit yourself.

Two operations: **record** a decision, **consult** before proposing.

```ts
import { DecisionLedger, loadLedger, saveLedger, nodeLedgerFs } from '@gemstack/ai-autopilot'

const fs = nodeLedgerFs()
const ledger = await loadLedger(fs)            // reads DECISIONS.md (empty if absent)

ledger.reject('Use Redux for state', 'Too much boilerplate; Zustand covers it', ['state'])
ledger.accept('Use Vike for SSR', 'Fits the stack')
await saveLedger(fs, ledger)                   // writes DECISIONS.md

ledger.wasRejected('add redux for state')      // true — do not re-propose
ledger.consult('add a redux store')            // [{ decision, score, overlap }]
```

Expose it to an agent so the policy runs itself: `consult_decisions` before it
proposes, `record_decision` after a choice is made, plus a system-prompt briefing
of the rejected set.

```ts
import { agent } from '@gemstack/ai-sdk'
import { decisionTools, decisionBriefing } from '@gemstack/ai-autopilot'

const worker = agent({
  instructions: [decisionBriefing(ledger), basePrompt].filter(Boolean).join('\n\n'),
  tools: decisionTools(ledger, { onRecord: l => saveLedger(fs, l) }),
})
```

`consult` matching is lexical and deterministic (token overlap over title +
tags), cheap enough to run before every proposal; a semantic upgrade can sit
behind the same contract later. The `LedgerFs` seam is a subset of the runner's
`RunnerFs`, so the ledger persists inside a sandbox the same way it does on the
host. This is the foundation "the loop" (#113) consults on major changes.

## The loop — event-triggered prompt chains

The web-app-specific orchestration policy that generic harnesses do not have.
The agent declares a **semantic change** and the right follow-up prompts fire on
their own: a major change runs review + code-quality + security; a new UI flow
runs QA + UX. Semantic (a *kind* of change picks a *set* of prompts), not
command-driven and not run-on-every-PR.

```ts
import { LoopEngine, definePrompt, defaultLoops } from '@gemstack/ai-autopilot'

const loop = new LoopEngine({
  loops: defaultLoops(),                 // major-change → [review, code-quality, security]; ui-flow → [qa, ux]
  prompts: [
    definePrompt({ id: 'review', passes: 2, run: ctx => runReview(ctx.event) }),
    definePrompt({ id: 'code-quality', run: ctx => runQuality(ctx.event) }),
    // ...register a prompt per id the loops reference
  ],
  ledger,                                    // optional: exposed to each prompt via ctx.ledger (#112)
  onEvent: e => log(e),                      // observe match / pass / done (observer-isolated)
})

await loop.handle({ kind: 'major-change', summary: 'reworked auth session handling', paths: ['src/auth/*'] })
```

Design choices for the two open questions:

- **What is a "major change"?** The agent **declares** it — the trigger is a
  `LoopEvent { kind }` the worker emits, not a heuristic the loop guesses. It is
  deterministic and it is the agent that knows intent. A heuristic classifier
  (supervisor-event → `LoopEvent`) can sit in front of `handle` later.
- **Sync or async?** Both. `handle()` awaits the whole chain (the sync story);
  `continueOnError: false` turns it into a **blocking gate** (a failing prompt
  stops the chain). For fire-and-report over a stream, feed events through
  `loop.watch(stream)`, or run `handle` inside `launchAutopilot` for a detached
  background run.

Each prompt runs for its `passes` with **fresh context every pass** (Rom's
finding: re-running the same prompt with a reset context improves the result), so
`run` is expected to build a new agent per call. `defaultLoops()` is the
built-in policy as data; extend it by concatenating your own `defineLoop` results.
The prompt bodies themselves are the prompts library (#111), registered under the
ids the loops reference.

## Built-in prompts — the loop's bodies, shipped as data

The loop dispatches prompts by id; the **prompts library** supplies the bodies.
They ship ready to use and already know the stack (Vike + universal-orm): review
(TLDR + thorough), code-quality, security, refactor, UX, QA, and a knowledge-base
template. Each is a markdown file under `prompts/`, so a contributor improves the
prompt by editing prose, not code.

`loopPromptsFor` materializes a library into loop prompts, so `defaultLoops()`
ids resolve to real bodies — this is the turnkey wire:

```ts
import { agent } from '@gemstack/ai-sdk'
import { LoopEngine, defaultLoops, builtinLibrary, loopPromptsFor, runnerTools } from '@gemstack/ai-autopilot'

const library = await builtinLibrary()          // the shipped bodies
const loop = new LoopEngine({
  loops: defaultLoops(),                     // review / code-quality / security / qa / ux ids
  prompts: loopPromptsFor(library, ctx =>        // a FRESH agent per pass
    agent({ instructions: ctx.instructions, tools: runnerTools(session) })),
  ledger,                                         // ctx.instructions already includes the decisions briefing
})

await loop.handle({ kind: 'major-change', summary: 'reworked auth', paths: ['src/auth/*'] })
```

`ctx.instructions` is the prompt body composed with the decisions briefing (#112),
ready to set on the agent; the agent carries whatever tools the prompt needs
(`runnerTools(session)` for file/exec, browser tools for the QA prompt). Load your
own bodies from a directory with `loadPromptsFrom(dir)`, or add one to a library
with `library.add(...)`. The bodies are the main open-source contribution surface;
PRs that sharpen them are welcome.

## Domain presets — loops + prompts bundled per domain

A **domain preset** packages a domain's review loops and prompt bodies as one
`{ loops, prompts }` unit, so a run's review policy suits a *kind* of work
(software, web, data, product, science) instead of the generic default.
Each preset is a directory of markdown under `presets/` — a `preset.md` manifest
plus `loops/` and `prompts/` — so a contributor adds one by writing files, not
code.

```ts
import { builtinDomainPresets, selectPreset } from '@gemstack/ai-autopilot'

const presets = await builtinDomainPresets()             // discovers every shipped preset
const sw = selectPreset(presets, 'software-development')  // sw.loops / sw.prompts
```

Five ship built in (`software-development`, `web-development`, `data-science`,
`product-management`, `biological-science`). Load your own with
`loadDomainPreset(dir)`, and merge several with `composeDomainPresets(...)`
(presets-of-presets). A mode variant (a `stem.<mode>.md` sibling carrying
`metadata.conditions`) swaps in a leaner loop under a mode like `technical`.
`@gemstack/framework` surfaces these to end users as `--preset`.

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
