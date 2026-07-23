# Browser Phase 2: bundle Chromium into the sandbox runner image

Phase 2 of #452. Phase 1 (merged, #466) gives the agent a browser on the **host** via chrome-devtools-mcp behind `--browser`. That covers dev-machine runs.

Phase 2 is the sandboxed version: bake Chromium + chrome-devtools-mcp into the Docker runner image so the browser works when the run is isolated in a container.

**Blocked** on the agent-in-container move (#109). Today the agent runs on the host and only the app is served inside the runner, so an in-image browser has nothing pointing at it. This only pays off once the agent itself runs inside the sandbox.

Scope when unblocked:
- Alpine needs `chromium` + fonts + `--no-sandbox`.
- MCP config points chrome-devtools-mcp at the in-container browser.
- Gated on a real Docker env (#109).

Also worth deciding first, from Phase 1 real-world use: is browser access valuable enough to carry into the sandbox story at all?

---
Source: https://github.com/gemstack-land/the-framework/issues/469
