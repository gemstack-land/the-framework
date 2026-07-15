# @gemstack/example-autopilot-quickstart

A runnable, end-to-end quickstart for [`@gemstack/ai-autopilot`](../../packages/ai-autopilot) — the four layers of the epic composed into one "build a feature" flow:

```
workers  →  Supervisor  →  runner (sandbox)  →  surfaces
```

A lead planner decomposes the task **"Add a paginated Orders page backed by an orders table"** and routes each subtask to one of the example's own **worker** agents (`data-modeler`, `page-builder`, `ui-designer`). The **Supervisor** dispatches them; each worker acts inside a **runner** sandbox — writing files through `runnerTools` — and progress is rendered through the **surfaces** (a terminal sink for live output, plus a background handle exposing events + result).

The roster is the app's own: autopilot orchestrates the agents you hand it and adds nothing to their instructions.

It runs **offline**: `AiFake` scripts the model, so there's no API key and the output is deterministic.

## Run it

```bash
pnpm install && pnpm build      # from the repo root, to build the packages first
pnpm --filter @gemstack/example-autopilot-quickstart start
```

You'll see the live plan, the files written into the sandbox, a build + preview URL, and the synthesized result.

## Test it

```bash
pnpm --filter @gemstack/example-autopilot-quickstart test
```

## Going real

The only fakes here are `AiFake` (the model) and `FakeRunner` (the sandbox). To run it for real, drop `AiFake` and give the workers real model strings, and swap `FakeRunner` for a real runner adapter (a `FlueRunner`, WebContainer, or Docker sandbox) — the `Runner` interface is the same, so nothing else in the flow changes.

## What each file shows

- **`src/autopilot.ts`** — the composition: the worker roster + `runnerTools`, `agentPlanner` fed that roster, a `Supervisor`, and `launchAutopilot` + `terminalSink` for the surfaces.
- **`src/main.ts`** — the runnable demo.
- **`src/autopilot.test.ts`** — asserts the four layers actually compose (plan routes by role, files land in the sandbox, surfaces capture events).
