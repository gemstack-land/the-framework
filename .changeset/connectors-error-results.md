---
'@gemstack/connectors': minor
'@gemstack/connector-github': patch
'@gemstack/connector-google-drive': patch
---

Return validation failures as MCP errors instead of success results.

The GitHub and Google Drive connectors returned `{ error: '...' }` for user-facing validation failures (get-file on a directory, get-file-content on a folder, share-file missing an email/domain). These normalized to a **success** `McpToolResult`, so an agent could not tell failure from data via the MCP `isError` flag. They now return `McpResponse.error(...)`, which sets `isError: true`.

`@gemstack/connectors` now re-exports `McpResponse` (and the `McpToolResult` type) so a connector's `handle` can signal these errors without depending on `@gemstack/mcp` directly.
