# Multi-agent race / tournament runs

## TLDR

Run the same intent across N agent/model combos in parallel and isolated, then compare the results and pick a winner from the dashboard.

## Why it matters

`AgentModelMenu` already lets a user pick one agent+model pair (`claude`/`codex`, #628) per run. For an ambiguous or high-stakes task, "which agent/model handles this best" is itself a real open question users have today, and there's no way to answer it except running the task twice, by hand, in two different checkouts, and eyeballing the diffs. A built-in "race" mode — run the same intent across N agent/model combos in parallel, isolated, and let the user compare and pick a winner — turns that manual chore into a first-class dashboard feature and is a differentiator no competitor mentioned in #110's landscape scan ships.

## Rough shape

- Start-run form: an "Compare agents" option next to the existing single `AgentModelMenu` pick — select 2–3 agent/model combos instead of one.
- Isolation: each combo needs its own workspace so the runs don't clobber each other's edits. Natural fit once git worktrees (#453) land; until then, a naive fallback (temp clone per combo) is acceptable and should be called out as the interim approach in the implementation.
- Execution: reuses the existing per-run pipeline (`run.ts`) unchanged, just invoked once per combo with its own workspace/branch; runs proceed concurrently, each streaming its own `EventList`/`RunFeed` as today.
- Comparison UI: a side-by-side view once all runs finish (or reach a mergeable/awaiting state) — diff stat, run duration, cost (where `reportsCost` is available, #628's `AgentSpec`), and pass/fail on the same review/security checklist (`steps.ts`) applied identically to every candidate so the comparison is apples-to-apples.
- Resolution: user picks a winner branch to open as the real PR; losing branches/worktrees are discarded (with a confirmation, since discarding is the one destructive step here).

## Open questions

- Cost: running N combos multiplies spend — needs its own `--max-cost` semantics (per-combo cap, not shared) and a clear estimate up front (dovetails with the pre-run cost estimate idea).
- Whether "race" is scoped to agent/model choice only, or later extended to competing *prompts* (e.g. two custom presets attacking the same intent) — start narrow (agent/model only).

## Related

- #628 (Select Model) / `AgentModelMenu` — the existing single-pick UI this extends.
- #453 (git worktrees) — the clean isolation mechanism; can ship with a temp-clone fallback first.
- #624 (queue), `dashboard/interventions.ts` — a race run surfaces as one queue item ("pick a winner") once all candidates settle.
