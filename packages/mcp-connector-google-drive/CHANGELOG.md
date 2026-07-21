# @gemstack/connector-google-drive

## 0.2.1

### Patch Changes

- Updated dependencies [dad26f4]
- Updated dependencies [fa15730]
- Updated dependencies [6f7cf23]
- Updated dependencies [7297961]
  - @gemstack/mcp@0.4.0
  - @gemstack/mcp-connectors@0.2.1

## 0.2.0

### Minor Changes

- e51bd7d: Rename the connector packages under the `mcp-` family prefix.

  - `@gemstack/connectors` → `@gemstack/mcp-connectors`
  - `@gemstack/connector-github` → `@gemstack/mcp-connector-github`
  - `@gemstack/connector-google-drive` → `@gemstack/mcp-connector-google-drive`

  A connector ships an MCP server, so this puts the packages in the same visible family as `@gemstack/mcp` and establishes `mcp-connector-<x>` as the naming convention third parties mirror (e.g. `@acme/mcp-connector-stripe`). The API is unchanged — only the package names. Update imports to the new names; the old packages are deprecated on npm.

### Patch Changes

- e8d730f: Return validation failures as MCP errors instead of success results.

  The GitHub and Google Drive connectors returned `{ error: '...' }` for user-facing validation failures (get-file on a directory, get-file-content on a folder, share-file missing an email/domain). These normalized to a **success** `McpToolResult`, so an agent could not tell failure from data via the MCP `isError` flag. They now return `McpResponse.error(...)`, which sets `isError: true`.

  `@gemstack/connectors` now re-exports `McpResponse` (and the `McpToolResult` type) so a connector's `handle` can signal these errors without depending on `@gemstack/mcp` directly.

- eaa667c: Wrap transport failures in the connector's typed error class.

  The clients only wrapped non-2xx responses in `GitHubError`/`GoogleDriveError`; a `fetch()` rejection (DNS failure, timeout, offline) escaped as a raw `TypeError`. Each `fetch` call site now rethrows transport failures as the connector's error type with `status: 0`, so all failures surface through one typed class.

- Updated dependencies [a037b8c]
- Updated dependencies [e8d730f]
- Updated dependencies [964e3d8]
- Updated dependencies [e51bd7d]
  - @gemstack/mcp-connectors@0.2.0
  - @gemstack/mcp@0.3.0

## 0.1.0

### Minor Changes

- 6e37d60: New package: the Google Drive connector for GemStack AI orchestration. Browse, read, and share Drive files over the Drive REST API (v3) — `get-about`, `list-files`, `search-files`, `get-file`, `get-file-content` (Docs/Sheets/Slides exported to text, other files downloaded), `list-permissions`, `create-folder`, `share-file`, `trash-file`. Built with `@gemstack/connectors`; consumes a Google OAuth 2.0 access token via the mount `credentials` seam. Second connector on the contract (epic #86).

### Patch Changes

- Updated dependencies [b0430f9]
  - @gemstack/connectors@0.1.0
