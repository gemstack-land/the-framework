---
'@gemstack/ai-mcp': patch
---

Fix `mcpClientTools()` leaking a transport (and any stdio subprocess) when `connect()` fails.

The connect path had no cleanup: if the handshake rejected, nothing closed the transport the bridge had just built, so an HTTP session or a spawned child process was orphaned and a retrying caller leaked one per attempt. The MCP SDK does not cover this either, since it never cleans up when `transport.start()` rejects and only fires an unawaited `close()` on an initialize failure. The connect is now wrapped, the client and the transport are both closed best-effort, and the original error is rethrown unchanged.
