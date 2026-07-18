# Pre-run cost & duration estimate

## TLDR

Show a rough cost and duration estimate before a run starts, derived from past runs already sitting in the run store.

## Why it matters

The start-run form lets a user set a hard `--max-cost` cap and the dashboard's `UsagePanel` shows quota consumed so far, but nothing today answers the question a user actually has *before* clicking start: "roughly how long will this take, and what will it cost?" Every past run's cost/duration is already sitting in the run store (`.the-framework/runs/*.json`, `run-store.ts`) — this is a matter of surfacing data that's already collected, not new instrumentation.

A rough estimate up front (e.g. "similar `security-audit` runs on this project: ~12 min, ~$1.80") makes `--max-cost` a much easier number to set, and lowers the anxiety of an unbounded-feeling `framework <intent>` invocation for a first-time user — a real paper-cut in the "why would I trust this" first-run trust curve #297's bootstrap-mode ticket is also trying to solve.

## Rough shape

- Data source: aggregate existing per-run records in the run store, grouped by a similarity key — same preset id (or same `--kind`/domain preset for open-ended intents), same project. Nothing new to persist; this reads history that's already written.
- Display: in `StartRunForm.tsx`, once a preset/agent/model is selected, show a small inline estimate ("based on N past runs") with a range (e.g. p25–p75), not a false-precision single number. No history for this preset/project yet → show nothing rather than a misleading guess.
- Live refinement: once a run starts, replace the static pre-run estimate with the running actual (cost/time so far vs. the estimate), reusing whatever `RunFeed`/`EventList` already streams.
- Cross-agent caveat: cost only exists for agents where `reportsCost` is true (#628's `AgentSpec`) — for others (e.g. Codex today, per the "unguarded" notice in `cli.ts`), show duration-only estimates and skip cost.

## Related

- #628 (Select Model) — the `AgentSpec.reportsCost` flag this estimate depends on.
- #313 (Database) / run store — the historical data source, already written today.
- #297 (Bootstrap mode) — same "lower the first-run trust barrier" motivation.
