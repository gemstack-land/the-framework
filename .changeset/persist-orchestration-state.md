---
'@gemstack/framework': minor
---

Persist the orchestration state so a restarted dashboard can resume it

A run now saves its orchestration state (the stack rationale, loop status, and decisions ledger) so it survives a restart. Because the dashboard is a pure projection of the run's `FrameworkEvent` stream, persisting is durably logging that stream: each run appends to `.framework/events.jsonl` in the workspace, keeps a small derived `run.json` snapshot beside it, and writes a human-readable `DECISIONS.md` at the root. `framework --resume` reopens the last run's dashboard read-only by replaying the log into a fresh stream, exactly as it looked, without running the agent again. `--no-persist` opts out of writing state.

Per the design sync we do not persist the agent's chat transcript (Claude Code owns that); only our own orchestration events. New `RunStore` module and exports (`RunStore`, `nodeStoreFs`, `metaFromEvents`, `applyEventToMeta`, `RunMeta`, `StoreFs`, ...); new `--resume` / `--no-persist` CLI flags.

Part of #209. Closes #211.
