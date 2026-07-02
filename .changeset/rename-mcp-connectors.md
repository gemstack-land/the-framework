---
'@gemstack/mcp-connectors': minor
'@gemstack/mcp-connector-github': minor
'@gemstack/mcp-connector-google-drive': minor
---

Rename the connector packages under the `mcp-` family prefix.

- `@gemstack/connectors` → `@gemstack/mcp-connectors`
- `@gemstack/connector-github` → `@gemstack/mcp-connector-github`
- `@gemstack/connector-google-drive` → `@gemstack/mcp-connector-google-drive`

A connector ships an MCP server, so this puts the packages in the same visible family as `@gemstack/mcp` and establishes `mcp-connector-<x>` as the naming convention third parties mirror (e.g. `@acme/mcp-connector-stripe`). The API is unchanged — only the package names. Update imports to the new names; the old packages are deprecated on npm.
