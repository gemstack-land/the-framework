# @gemstack/ai-mcp

## 0.1.3

### Patch Changes

- 6f7cf23: Fix `mcpServerFromAgent` crashing on a tool whose `execute` fn returns synchronously.

  The generator check was `out instanceof Promise`, so anything that wasn't a native Promise was treated as an async generator and died on `iter.next is not a function`, surfaced to the MCP client as an opaque internal error. `.server()` explicitly accepts `TReturn | Promise<TReturn>`, so a bare return (or a non-native thenable) is legal. It now duck-types the generator the way `@gemstack/mcp` already does.

- 6f7cf23: Fix four orchestration correctness bugs and tidy the package surface.

  - `exec()` now runs in its own process group and settles even when a background grandchild outlives the shell. Previously a command like `npm install` that left a daemon behind kept the inherited stdio open, so `close` never fired and the call never settled, blowing past its own `timeoutMs`.
  - `serveCheck` bounds its health-check fetch. A dev server that accepts the connection but never answers used to hang the bootstrap pass loop forever, since neither the fetch nor the process exit could settle.
  - A blocking loop chain (`continueOnError: false`) now stops at an unknown prompt id instead of running past it. A typo'd or unregistered id silently bypassed a gate that a _throwing_ prompt would have stopped.
  - `runPool` no longer reports truncation when the budget is met exactly by the final item, which surfaced as a false `stoppedEarly` / `budget-exceeded` with `skipped: 0` on a plan that ran to completion. Worker errors also propagate through `allSettled`, so one failure cannot orphan its siblings into unhandled rejections.

  Also: exported `AgentSynthesizerOptions` (the only `agent*` factory whose options were unnameable), dropped three dead imports in `bootstrap/steps.ts`, corrected two doc comments that claimed one shipped domain preset when five ship, removed a doc comment describing a function that had moved, and fixed `clean` scripts that left `dist-test/` behind (stale compiled tests cause phantom failures).

- 585e545: `mcpClientTools({ streaming: true })` now forwards progress while the remote tool runs, instead of replaying it at the end.

  Progress notifications were collected into an array during `callTool()` and only yielded once it had resolved, so no `tool-update` chunk could reach a consumer while the remote tool was still working: a progress bar driven by them jumped from empty straight to complete, which is nothing the non-streaming path does not already do. Each notification is now yielded as it lands.

  The batching had been protecting the chunk order, and that guarantee still holds: the generator only returns after the call settles, and drains anything still queued first, so every `tool-update` chunk still precedes the tool's result.

- 585e545: Fix `mcpClientTools()` leaking a transport (and any stdio subprocess) when `connect()` fails.

  The connect path had no cleanup: if the handshake rejected, nothing closed the transport the bridge had just built, so an HTTP session or a spawned child process was orphaned and a retrying caller leaked one per attempt. The MCP SDK does not cover this either, since it never cleans up when `transport.start()` rejects and only fires an unawaited `close()` on an initialize failure. The connect is now wrapped, the client and the transport are both closed best-effort, and the original error is rethrown unchanged.

- Updated dependencies [6f7cf23]
- Updated dependencies [6f7cf23]
- Updated dependencies [da79ec8]
  - @gemstack/ai-sdk@0.5.1

## 0.1.2

### Patch Changes

- Updated dependencies [dbc8b3a]
- Updated dependencies [1b2ba93]
  - @gemstack/ai-sdk@0.5.0

## 0.1.1

### Patch Changes

- Updated dependencies [e784b5d]
- Updated dependencies [97ed299]
- Updated dependencies [4fa5820]
- Updated dependencies [cf28664]
- Updated dependencies [035050e]
- Updated dependencies [3cb13db]
  - @gemstack/ai-sdk@0.4.0

## 0.1.0

### Minor Changes

- 9da9b29: Initial release. The agent<->MCP bridge, carved out of `@gemstack/ai-sdk`'s former `./mcp` subpath:

  - `mcpClientTools(transport, opts?)` — consume a remote MCP server's tools as `@gemstack/ai-sdk` Agent tools (HTTP URL / stdio spawn / connected SDK client).
  - `mcpServerFromAgent(AgentClass, opts?)` — expose an Agent as an MCP server, with `'tools'` / `'agent'` / `'both'` exposure modes.

  Depends on `@gemstack/ai-sdk`; `@modelcontextprotocol/sdk` is an optional peer.

### Patch Changes

- Updated dependencies [9da9b29]
  - @gemstack/ai-sdk@0.3.0
