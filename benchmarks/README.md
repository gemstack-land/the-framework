# GemStack AI benchmark: "our AI" vs Next.js

Tracking issue: [#75](https://github.com/gemstack-land/gemstack/issues/75). This is the harness for measuring how an AI coding agent performs with the GemStack orchestration layer in reach versus a vanilla Next.js app, on two metrics:

1. **Time-to-task** - wall clock from task start to the acceptance script passing.
2. **Human interventions** - count of times a human had to step in (see the rubric below).

This is **not** the self-healing loop. It measures an AI agent building and changing apps.

## Layout

```
benchmarks/
  README.md            <- you are here
  spec/
    product.md         <- the product surface both apps implement (shared HTTP contract)
    task-001-tags.md   <- the Phase 0 task + acceptance criteria
  tasks/
    task-001-tags/
      accept.mjs        <- contract-level acceptance script (BASE_URL env, exit 0 = pass)
examples/
  bench-app-next/       <- Next.js baseline app (vanilla)
  bench-app-gemstack/   <- Vike + React app wired with @gemstack/ai-*
```

Both apps implement the **same HTTP contract** (`spec/product.md`), so a single acceptance script runs against either by pointing `BASE_URL` at the running server.

## Phases

- **Phase 0** ([#78](https://github.com/gemstack-land/gemstack/issues/78)) - one task, both apps, manual stopwatch + manual intervention tally. Proves the method and the rubric. **(this directory)**
- **Phase 1** ([#79](https://github.com/gemstack-land/gemstack/issues/79)) - semi-automated runner over a 3 to 5 task set.
- **Phase 2** ([#80](https://github.com/gemstack-land/gemstack/issues/80)) - full suite, aggregator, committed baseline.

## Running Phase 0 by hand

For each app (`bench-app-next`, `bench-app-gemstack`):

1. Reset the app to its starting commit (clean baseline).
2. Start the dev server, note the URL.
3. Start a stopwatch. Give the agent the task prompt from `spec/task-001-tags.md`.
4. Let the agent work. Tally every **human intervention** (rubric below).
5. After each agent step, run the acceptance script: `BASE_URL=<url> node benchmarks/tasks/task-001-tags/accept.mjs`. Exit 0 means done; stop the stopwatch.
6. Record seconds, intervention count, and status (pass / DNF) in a run log.

Stop at acceptance pass, or at the hard timeout / max-intervention cap (record as DNF).

## Intervention rubric

Counts as **one human intervention**:

- a manual code correction by a human
- unblocking a stuck agent with a hint
- a clarification the agent had to ask before it could proceed
- an approval gate that required a human
- a manual retry / rerun a human had to trigger

Does **not** count (this is the point of the orchestration layer):

- the agent's own internal retries, planning, and autopilot worker dispatch
- skill / MCP tool calls the agent makes autonomously

## Fairness rules

- Same agent, same model, same harness on both sides.
- Both apps start from a clean, functionally-equivalent baseline implementing the contract.
- The acceptance gate is objective (the script's exit code); no human judgement.
- The Next.js app must be idiomatic, not a strawman.
