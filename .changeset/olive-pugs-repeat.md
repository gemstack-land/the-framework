---
'@gemstack/mcp': minor
'@gemstack/mcp-connectors': patch
'@gemstack/mcp-connector-github': patch
'@gemstack/mcp-connector-google-drive': patch
---

Remove the dead `Mcp` server registry and correct the docs to the real mounting API.

`@gemstack/mcp` exported `Mcp.web()` / `Mcp.local()` / `Mcp.getWebServers()` / `Mcp.getLocalServers()`, backed by a store on the `__gemstack_mcp_servers__` global. Nothing in the repo ever read that store: no package, no example, no runtime path. Six README and docs pages nevertheless presented `Mcp.web(path, ServerClass)` as the way to mount a server, so anyone following them registered into a map nobody read, got no error, and got no working endpoint.

Removed: `Mcp`, `McpWebEntry`, `McpWebBuilder`, and the global store. The real, already-working mounts are unchanged: `createMcpHttpHandler(server)` for raw `node:http` / Express / Connect (main entry), `createWebRequestHandler(server)` for Fetch-style hosts and `startStdio(server)` for stdio (both from `@gemstack/mcp/runtime`). Note the shape difference the old docs hid: these take a server *instance*, not a class.

`@gemstack/mcp` takes a minor rather than a major: it is pre-1.0, where a breaking removal is conventionally a minor, and no working code can be relying on the removed surface since nothing ever consumed it. The connector packages take a patch: their published READMEs (and, for `@gemstack/mcp-connectors`, the `mountConnectors` JSDoc that ships in its `.d.ts`) carried the false mount snippet, so the corrected text is worth a release.
