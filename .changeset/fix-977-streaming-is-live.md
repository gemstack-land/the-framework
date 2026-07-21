---
'@gemstack/ai-mcp': patch
---

`mcpClientTools({ streaming: true })` now forwards progress while the remote tool runs, instead of replaying it at the end.

Progress notifications were collected into an array during `callTool()` and only yielded once it had resolved, so no `tool-update` chunk could reach a consumer while the remote tool was still working: a progress bar driven by them jumped from empty straight to complete, which is nothing the non-streaming path does not already do. Each notification is now yielded as it lands.

The batching had been protecting the chunk order, and that guarantee still holds: the generator only returns after the call settles, and drains anything still queued first, so every `tool-update` chunk still precedes the tool's result.
