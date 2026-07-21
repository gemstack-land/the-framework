---
'@gemstack/ai-mcp': patch
---

Fix `mcpServerFromAgent` crashing on a tool whose `execute` fn returns synchronously.

The generator check was `out instanceof Promise`, so anything that wasn't a native Promise was treated as an async generator and died on `iter.next is not a function`, surfaced to the MCP client as an opaque internal error. `.server()` explicitly accepts `TReturn | Promise<TReturn>`, so a bare return (or a non-native thenable) is legal. It now duck-types the generator the way `@gemstack/mcp` already does.
