/**
 * `@gemstack/ai-sdk/mcp` — bridge between `@gemstack/ai-sdk` Agents and Model Context
 * Protocol servers. Two connectors:
 *
 * - {@link mcpClientTools} — consume a remote MCP server's tools as Agent tools
 * - {@link mcpServerFromAgent} — expose an Agent as an MCP server external
 *   clients (Claude Desktop, Cursor, etc.) can call
 *
 * Requires `@modelcontextprotocol/sdk` at runtime — declared as an optional
 * peer dependency. Apps that don't import this subpath aren't forced to
 * install it.
 */
export { mcpClientTools } from './client-tools.js'
export { mcpServerFromAgent } from './server-from-agent.js'
export type {
  McpClientTransport,
  McpClientToolsOptions,
  McpServerFromAgentOptions,
  StdioServerSpawn,
} from './types.js'
