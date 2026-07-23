# @gemstack/connectors

## 0.2.2

### Patch Changes

- 9258b84: Remove the dead `Mcp` server registry and correct the docs to the real mounting API.

  `@gemstack/mcp` exported `Mcp.web()` / `Mcp.local()` / `Mcp.getWebServers()` / `Mcp.getLocalServers()`, backed by a store on the `__gemstack_mcp_servers__` global. Nothing in the repo ever read that store: no package, no example, no runtime path. Six README and docs pages nevertheless presented `Mcp.web(path, ServerClass)` as the way to mount a server, so anyone following them registered into a map nobody read, got no error, and got no working endpoint.

  Removed: `Mcp`, `McpWebEntry`, `McpWebBuilder`, and the global store. The real, already-working mounts are unchanged: `createMcpHttpHandler(server)` for raw `node:http` / Express / Connect (main entry), `createWebRequestHandler(server)` for Fetch-style hosts and `startStdio(server)` for stdio (both from `@gemstack/mcp/runtime`). Note the shape difference the old docs hid: these take a server _instance_, not a class.

  `@gemstack/mcp` takes a minor rather than a major: it is pre-1.0, where a breaking removal is conventionally a minor, and no working code can be relying on the removed surface since nothing ever consumed it. The connector packages take a patch: their published READMEs (and, for `@gemstack/mcp-connectors`, the `mountConnectors` JSDoc that ships in its `.d.ts`) carried the false mount snippet, so the corrected text is worth a release.

- Updated dependencies [9258b84]
  - @gemstack/mcp@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [dad26f4]
- Updated dependencies [fa15730]
- Updated dependencies [6f7cf23]
- Updated dependencies [7297961]
  - @gemstack/mcp@0.4.0

## 0.2.0

### Minor Changes

- e8d730f: Return validation failures as MCP errors instead of success results.

  The GitHub and Google Drive connectors returned `{ error: '...' }` for user-facing validation failures (get-file on a directory, get-file-content on a folder, share-file missing an email/domain). These normalized to a **success** `McpToolResult`, so an agent could not tell failure from data via the MCP `isError` flag. They now return `McpResponse.error(...)`, which sets `isError: true`.

  `@gemstack/connectors` now re-exports `McpResponse` (and the `McpToolResult` type) so a connector's `handle` can signal these errors without depending on `@gemstack/mcp` directly.

- e51bd7d: Rename the connector packages under the `mcp-` family prefix.

  - `@gemstack/connectors` → `@gemstack/mcp-connectors`
  - `@gemstack/connector-github` → `@gemstack/mcp-connector-github`
  - `@gemstack/connector-google-drive` → `@gemstack/mcp-connector-google-drive`

  A connector ships an MCP server, so this puts the packages in the same visible family as `@gemstack/mcp` and establishes `mcp-connector-<x>` as the naming convention third parties mirror (e.g. `@acme/mcp-connector-stripe`). The API is unchanged — only the package names. Update imports to the new names; the old packages are deprecated on npm.

### Patch Changes

- a037b8c: Aggregate each connector's `instructions` into the mounted server's metadata.

  `mountConnectors` previously read only the server-level `instructions` option and ignored `Connector.instructions`, so per-connector instructions set by `defineConnector` were silently dropped. They are now composed into the server instructions: the server-level text first, then each connector's text under a heading named after the connector.

- Updated dependencies [964e3d8]
  - @gemstack/mcp@0.3.0

## 0.1.0

### Minor Changes

- b0430f9: New package: the connector contract for GemStack AI orchestration. `defineConnector` declares a tool connector to an external service (its auth requirement + tools); `mountConnectors` composes any number into a single `@gemstack/mcp` server, namespacing tools by connector id and resolving credentials at call time. Built on `@gemstack/mcp`, framework-agnostic. First step of the connectors epic (GitHub, Google Drive to follow).
