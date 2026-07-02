# @gemstack/ai-autopilot

## 0.2.0

### Minor Changes

- 70168c5: Add bootstrap's deploy phase and the `DeployTarget` adapter seam. The final phase decides the rendering mode (SSR/SSG/SPA) and the deploy target (Dockploy vs Cloudflare), narrates the plan, and hands it to a `DeployTarget` — the same pattern as the runner seam. `agentDeploy` is the default step (an `ai-sdk` agent decides `{ render, target, reason }`, normalized against the allowed sets); `planOnlyTarget` is the v1 default that decides and narrates without shipping, and `FakeDeployTarget` backs tests. v1 decides + narrates only; real Dockploy / Cloudflare adapters implement `DeployTarget` and are infra-gated follow-ups, so bootstrap never does a blind deploy. The deploy step is optional and its outcome rides on `BootstrapResult.deploy`. Closes #123.
- 11dce73: Add bootstrap mode's orchestrator core: the spine that sequences autopilot's primitives into scope → architect → build → full-fledged loop, taking a user from nothing to a running, production-grade app. `Bootstrap` owns the control flow (the loop, the gate, the interrupt) over four injectable steps, narrating each phase over the generic surface stream and recording the architect's choices to the decisions ledger — no permission asked. The full-fledged loop repeats the production-grade checklist with fresh context, improving against its `{ blockers }` verdict until it is empty or a `maxPasses` budget stops it; prototype scope skips it. Default step builders wire the steps onto the real primitives — `agentArchitect` (an `ai-sdk` agent + the decisions briefing), `supervisorBuild` (the `Supervisor` over personas + runner), and `loopChecklist` / `loopImprove` (the Loop) — so the same orchestrator runs against real agents in production or stubs + `FakeRunner` in a test. Verified end-to-end offline. Closes #122.
- aa1925f: Add scale mode: an always-current `CODE-OVERVIEW.md` the agent reads first in a large repo so it stays oriented without re-scanning the tree. The hard part is keeping it fresh — a stale overview is worse than none — so refreshes are gated by a deterministic **material-change detector** (`detectMaterialChange`): a build/config change, a test-framework migration, a directory restructure, or a large change across many areas, not every routine edit. `CodeOverviewMaintainer` owns the policy (refresh on material change, skip otherwise, persist over an `OverviewFs`); `agentOverview` regenerates the map with an `ai-sdk` agent (seeding the previous overview so it revises rather than rewrites); and `overviewLoopPrompt` drops the maintainer into the loop (#113) so it self-maintains on `major-change`. The `CODE-OVERVIEW.md` markdown round-trips via `parseOverview` / `serializeOverview`. Regeneration is injected, so the whole policy is tested offline against a stub. Closes #114.
- c9b4d0d: Add the decisions ledger: durable project memory so a run stops re-pitching ideas that were already turned down. `DecisionLedger` records rejected ideas and settled choices and answers `consult(idea)` / `wasRejected(idea)` (lexical token-overlap matching, deterministic) before the agent proposes; it round-trips a human-editable `DECISIONS.md` via `loadLedger` / `saveLedger` over a storage-agnostic `LedgerFs` seam (a subset of the runner's `RunnerFs`, with a `nodeLedgerFs()` host adapter). `decisionTools(ledger)` exposes `consult_decisions` + `record_decision` to an agent and `decisionBriefing(ledger)` renders the rejected set as a system-prompt fragment. Verified end-to-end on real disk. First child (#112) of the AI-framework epic (#110); the state layer "the loop" (#113) will consult.
- 57cbba4: Add the web-app preset seam: framework-specific knowledge selected by detecting the app's framework, on top of the agnostic core. A `Preset` bundles a framework's personas with the signals that identify it; `detectFramework` scores a project's dependencies + files (deps weigh more than files) and `PresetRegistry.select` picks the preset (falling back to the flagship when nothing matches). Ships two built-ins — `vikePreset` (flagship) and `nextPreset` — plus a new `nextPageBuilder` persona (App Router + React Server Components). `presetPersonas(preset)` returns the framework page builder followed by the shared, framework-neutral personas (`sharedPersonas`: the universal-orm modeler + intent-UI designer), so only the page builder changes between frameworks while the rest of the stack stays put and prompts stay neutral. One shared core; a new framework is a new `Preset`, not a runtime fork. Closes #115.
- 04965c5: Generalize the surface stream to be event-type generic. `EventStream<E>`, `AutopilotHandle<E, R>`, and `launchAutopilot<E, R>` now take the event (and result) type as parameters, defaulting to the supervisor's `SupervisorEvent` / `SupervisorRun` so every existing supervisor surface is unchanged. This lets bootstrap (and any future surface) stream its own narration events and return its own result over the same replayable, detached transport. Closes #120.
- 07cc623: Add `LocalRunner`, the first real adapter behind the runner seam. Where `FakeRunner` simulates a workspace in memory, `LocalRunner` boots each workspace as a real temp directory on the host: real files via `node:fs` (path-traversal guarded to the workspace root), real commands via `child_process` (shell, per-command `cwd`/`env`/`timeoutMs`), a localhost `preview`, and a `dispose()` that removes the workspace. It is the reference the sandboxed adapters (WebContainer, Docker, Flue) mirror. It runs commands unsandboxed on the host, so it is documented for trusted/CI use only, not untrusted agent-authored code. Part of the ai-autopilot epic (#97), issue #106.
- 7fde5fc: Add the personas layer: stack-aware roles that make autopilot opinionated about the GemStack stack (Vike + universal-orm) instead of generic. `definePersona()` builds a role from a system prompt + skills (composed over `@gemstack/ai-skills`) + tools; `personaAgent()`/`personaWorkers()` materialize personas into Supervisor workers; `personaRoster()` describes them to a planner so plans route to the right role. Ships three built-ins: `vikePageBuilder`, `universalOrmModeler`, and `uiIntentDesigner` (the "declare intent, decouple implementation" UI guardrail). First child (#98) of the ai-autopilot end-to-end epic (#97).
- 55b3697: Add the `production-grade` checklist prompt and a `{ blockers }` verdict convention. The new built-in prompt judges an app against a production-grade checklist (auth, data layer, error handling, instrumentation, emailing, validation, tests, build/config) and ends with a machine-readable `{ "blockers": [...] }` verdict — an empty list means production-grade. `parseVerdict()` / `isPassing()` read it back, and the loop now gates on that outcome: a `PromptOutcome` carries `verdict` and a `passing` flag (executed _and_ no blockers), and `continueOnError: false` stops the chain on `!passing`. Backward compatible — with no verdict reported, `passing === ok`; pass `verdict: null` for an execution-only gate. This is what bootstrap's full-fledged loop repeats against until blockers is empty. Closes #121.
- 8f780f3: Add the built-in prompts library: the stack-aware prompt _bodies_ the loop dispatches, shipped as data. Eight markdown bundles under `prompts/` (review TLDR + thorough, code-quality, security, refactor, UX, QA, knowledge-base) that already know Vike + universal-orm, loaded with `builtinLibrary()` / `loadPromptsFrom(dir)` into a `PromptLibrary` and parsed via `@gemstack/ai-skills`' frontmatter (a contributor edits prose, not code). `loopPromptsFor(library, makeAgent)` materializes them into loop prompts so `defaultLoopRules()` ids resolve to real bodies (a fresh agent per pass); `promptInstructions` composes a body with the decisions briefing (#112) and `renderTask` turns a `LoopEvent` into the worker's task. Closes the turnkey wire across #111 / #112 / #113. Verified end-to-end against the built package. Child #111 of the AI-framework epic (#110).
- b0c0647: Add the runner seam: a pluggable `Runner` execution environment (workspace filesystem + shell + optional preview URL), shaped after Flue's `sandbox` contract so WebContainer, Docker, and Flue sandboxes drop in behind one interface. Ships the interface plus `FakeRunner` (the runner analog of `ai-sdk`'s `AiFake`) for infra-free testing, and `runnerTools(session)` to expose a booted session to an agent as sandbox tools (`read_file`, `write_file`, `list_files`, `exec`, `preview`). Real adapters (FlueRunner, WebContainer, Docker) land separately. Interface-first slice of the runner child (#99) of the ai-autopilot epic (#97).
- d261873: Add surfaces: run the same autopilot in the terminal, an in-page UI, or a background process, all over the Supervisor's `onEvent` stream. `terminalSink()` prints events inline (`formatEvent()` renders one event as a line); `EventStream` is a replayable multi-consumer transport with offset/tail replay (borrowing Flue's Durable-Streams `tail=N`); `launchAutopilot(start)` runs a Supervisor detached and returns an `AutopilotHandle` (`status()`, `events(offset)`, live async `stream()`, `result()`) that backs both the background and in-page (SSE) surfaces. Verified end-to-end against a real Supervisor. Closes the surfaces child (#100) of the ai-autopilot epic (#97).
- 481c2f0: Add "the loop": the event-to-prompt-chain policy. The agent declares a semantic `LoopEvent` (a change `kind`) and the matching prompt chain fires: a major change runs review + code-quality + security, a new UI flow runs QA + UX. `Loop.handle(event)` resolves the chain from `LoopRule`s (`defineRule` / `defaultLoopRules()` as the built-in policy) and runs each `LoopPrompt` (`definePrompt`) for its `passes` with fresh context every pass; `matches(event)` is the pure preview, `watch(stream)` handles a stream fire-and-report. Design calls on the two open questions: the trigger is agent-declared (not heuristic), and both modes ship (`handle` awaits; `continueOnError: false` is a blocking gate). Consults the decisions ledger via `ctx.ledger`, and references the prompts library (#111) by id. Verified end-to-end. Child #113 of the AI-framework epic (#110).

## 0.1.2

### Patch Changes

- Updated dependencies [dbc8b3a]
- Updated dependencies [1b2ba93]
  - @gemstack/ai-sdk@0.5.0

## 0.1.1

### Patch Changes

- 81fe17b: Quality + docs pass for ai-autopilot:

  - `Supervisor` now validates its options at construction (`plan` must be a function, `workers` is required, `concurrency`/`maxSubtasks` must be positive integers) and `run()` rejects an empty task, so misconfiguration fails fast with a clear message instead of deep in a planner call.
  - An `onEvent` callback that throws is now isolated (logged and swallowed) so an observer bug can no longer abort a supervised run.
  - Corrected the `SupervisorRun.usage` docs: it aggregates dispatched-subtask usage only (the `Planner`/`Synthesizer` contracts return data, not usage, so planning/synthesis spend isn't observable).
  - Clarified that `maxSubtasks` and `budget` are optional, marked the internal `runPool` helper `@internal`, and added JSDoc examples.

- Updated dependencies [e784b5d]
- Updated dependencies [97ed299]
- Updated dependencies [4fa5820]
- Updated dependencies [cf28664]
- Updated dependencies [035050e]
- Updated dependencies [3cb13db]
  - @gemstack/ai-sdk@0.4.0

## 0.1.0

### Minor Changes

- 8796ae4: Initial release. Orchestration for `@gemstack/ai-sdk` agents — the control-policy layer over many agent runs. Seed slice: the supervisor/worker topology.

  - `Supervisor` — **plan → dispatch → synthesize**: decompose a task into subtasks, dispatch each to a worker agent (bounded concurrency, optional token budget, per-subtask error isolation), and synthesize the results.
  - `agentPlanner(agent)` — turn a planning agent into a `Planner` via `ai-sdk`'s `Output.array` (JSON subtask decomposition).
  - `agentSynthesizer(agent)` / `defaultSynthesize` — combine subtask results (LLM pass, or deterministic concatenation).
  - Pluggable stages (`plan` / `workers` / `synthesize`), guardrails (`concurrency`, `maxSubtasks`, `budget.maxTotalTokens`), and progress events.

  Scope boundary: `ai-sdk` owns the single-agent loop + handoff/subagent primitives; `ai-autopilot` owns orchestrating multiple runs under a policy. The seed runs autonomous workers; durable pause/resume, more topologies, and queue-backed execution are deferred behind optional seams. Depends on `@gemstack/ai-sdk`.

### Patch Changes

- Updated dependencies [9da9b29]
  - @gemstack/ai-sdk@0.3.0
