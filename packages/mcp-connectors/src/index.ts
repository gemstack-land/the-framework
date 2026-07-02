export { defineConnector } from './defineConnector.js'
export { mountConnectors } from './mountConnectors.js'
export type { ConnectorServerClass, MountOptions } from './mountConnectors.js'
// Re-exported so a connector's `handle` can signal an expected, user-facing
// failure as an MCP error (`isError: true`) via `McpResponse.error(...)`
// without depending on `@gemstack/mcp` directly.
export { McpResponse } from '@gemstack/mcp'
export type { McpToolResult } from '@gemstack/mcp'
export type {
  Connector,
  ConnectorDefinition,
  ConnectorTool,
  ConnectorToolAnnotations,
  ConnectorToolReturn,
  ConnectorAuth,
  ConnectorContext,
  Credential,
} from './types.js'
