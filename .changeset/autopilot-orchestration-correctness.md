---
'@gemstack/ai-autopilot': patch
'@gemstack/ai-mcp': patch
'@gemstack/ai-skills': patch
---

Fix four orchestration correctness bugs and tidy the package surface.

- `exec()` now runs in its own process group and settles even when a background grandchild outlives the shell. Previously a command like `npm install` that left a daemon behind kept the inherited stdio open, so `close` never fired and the call never settled, blowing past its own `timeoutMs`.
- `serveCheck` bounds its health-check fetch. A dev server that accepts the connection but never answers used to hang the bootstrap pass loop forever, since neither the fetch nor the process exit could settle.
- A blocking loop chain (`continueOnError: false`) now stops at an unknown prompt id instead of running past it. A typo'd or unregistered id silently bypassed a gate that a *throwing* prompt would have stopped.
- `runPool` no longer reports truncation when the budget is met exactly by the final item, which surfaced as a false `stoppedEarly` / `budget-exceeded` with `skipped: 0` on a plan that ran to completion. Worker errors also propagate through `allSettled`, so one failure cannot orphan its siblings into unhandled rejections.

Also: exported `AgentSynthesizerOptions` (the only `agent*` factory whose options were unnameable), dropped three dead imports in `bootstrap/steps.ts`, corrected two doc comments that claimed one shipped domain preset when five ship, removed a doc comment describing a function that had moved, and fixed `clean` scripts that left `dist-test/` behind (stale compiled tests cause phantom failures).
