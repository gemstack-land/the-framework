/**
 * Public types for `@gemstack/ai-sdk/mcp`. Kept in a separate module so the
 * client + server connectors can share them without circular imports.
 */

/**
 * Configuration for spawning a local MCP server as a stdio subprocess.
 * Mirrors `StdioServerParameters` from `@modelcontextprotocol/sdk` but is
 * re-exported here so consumers don't need a direct SDK import for the
 * common case.
 */
export interface StdioServerSpawn {
  command: string
  args?:   readonly string[]
  /** Inherited from the parent process when omitted. */
  env?:    Readonly<Record<string, string>>
  /** Working directory for the spawned process. */
  cwd?:    string
}

/**
 * Anything `mcpClientTools()` accepts as the connection target.
 *
 * - `string` / `URL` — connects via the Streamable HTTP transport
 * - `StdioServerSpawn` — spawns a subprocess and connects over stdio
 * - existing `Client` instance — used as-is, lifecycle remains the caller's
 *
 * Implementation note: keeping `Client` as `unknown` here so the type union
 * doesn't force a hard dep on `@modelcontextprotocol/sdk` at module load.
 * The runtime code uses an instanceof check via dynamic import.
 */
export type McpClientTransport =
  | string
  | URL
  | StdioServerSpawn
  | object  // already-connected Client from @modelcontextprotocol/sdk

export interface McpClientToolsOptions {
  /** Filter exposed tools — return `false` to drop a remote tool from the result. Defaults to all. */
  filter?: (toolName: string) => boolean
  /** Prefix tool names to avoid collisions when wiring multiple remote servers. */
  namePrefix?: string
  /**
   * Forward MCP `notifications/progress` from the remote server as `tool-update`
   * chunks during agent execution. Defaults to `true`.
   */
  streaming?: boolean
}

export interface McpServerFromAgentOptions {
  /** Server name advertised over MCP. Default: `${AgentClass.name}Server`. */
  name?: string
  /** Server version. Default: `'1.0.0'`. */
  version?: string
  /**
   * Server instructions advertised over MCP — typically the agent's own
   * system prompt. Default: tries `agent.instructions()`, falls back to undefined.
   */
  instructions?: string
  /**
   * What to expose:
   * - `'tools'` (default): one MCP tool per `agent.tools()` entry — external
   *   MCP clients call them as if they were the server's own.
   * - `'agent'`: one MCP tool `prompt(text: string)` that runs the whole agent
   *   and returns the response text. Ship one agent, callable from any MCP client.
   * - `'both'`: both of the above.
   */
  expose?: 'tools' | 'agent' | 'both'
  /** Name of the synthetic prompt-tool when `expose: 'agent' | 'both'`. Default: agent class name. */
  agentToolName?: string
}
