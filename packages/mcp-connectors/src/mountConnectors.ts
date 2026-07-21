import {
  McpServer,
  McpTool,
  McpResponse,
  IsReadOnly,
  IsDestructive,
  IsIdempotent,
  IsOpenWorld,
} from '@gemstack/mcp'
import type { McpServerOptions, McpToolResult, ZodLikeObject } from '@gemstack/mcp'
import type { Connector, ConnectorContext, ConnectorTool, ConnectorToolReturn, Credential } from './types.js'

/** A constructable MCP server: instantiate it for a transport handler or `McpTestClient`. */
export type ConnectorServerClass = new (options?: McpServerOptions) => McpServer

export interface MountOptions {
  /** Server name advertised to clients. Default `"connectors"`. */
  name?: string
  /** Server version. Default `"1.0.0"`. */
  version?: string
  /** Server-level instructions surfaced to the agent. */
  instructions?: string
  /**
   * Resolve the credential for a connector at tool-call time. Called with the
   * connector id before each tool runs; return `undefined` for connectors that
   * need none. This is the seam the orchestrator implements to satisfy each
   * connector's declared {@link Connector.auth}.
   */
  credentials?: (connectorId: string) => Credential | undefined | Promise<Credential | undefined>
  /**
   * How tool names are disambiguated across connectors.
   * - `'prefix'` (default): `"<connectorId>_<toolName>"`.
   * - `'none'`: tool names kept verbatim (you must ensure they don't collide).
   */
  namespace?: 'prefix' | 'none'
}

/**
 * Compose any number of connectors into a single MCP server class. Each
 * connector's tools become MCP tools on one server, namespaced by connector id
 * so names never collide. The returned class plugs straight into the
 * @gemstack/mcp surface: instantiate it and hand the instance to a transport
 * handler (`createMcpHttpHandler`, `createWebRequestHandler`, `startStdio`), or
 * drive it in tests with `McpTestClient`.
 *
 * ```ts
 * const Server = mountConnectors([github, drive], {
 *   credentials: (id) => ({ token: process.env[`${id.toUpperCase()}_TOKEN`] }),
 * })
 * const handler = createMcpHttpHandler(new Server())
 * ```
 */
export function mountConnectors(connectors: Connector[], options: MountOptions = {}): ConnectorServerClass {
  const namespace = options.namespace ?? 'prefix'
  const toolClasses: (new () => McpTool)[] = []
  const seen = new Set<string>()

  for (const connector of connectors) {
    for (const tool of connector.tools) {
      const toolName = namespace === 'prefix' ? `${connector.id}_${tool.name}` : tool.name
      if (seen.has(toolName)) {
        throw new Error(
          `mountConnectors: duplicate tool name "${toolName}" — two connectors expose the same tool (use namespace: 'prefix')`,
        )
      }
      seen.add(toolName)
      toolClasses.push(makeToolClass(connector, tool, toolName, options))
    }
  }

  const name = options.name ?? 'connectors'
  const version = options.version ?? '1.0.0'
  const instructions = composeInstructions(connectors, options.instructions)

  return class ConnectorsServer extends McpServer {
    protected override tools = toolClasses
    override metadata() {
      return { name, version, ...(instructions != null ? { instructions } : {}) }
    }
  }
}

/**
 * Combine the server-level instructions with each connector's own
 * {@link Connector.instructions} into the single string advertised to the agent.
 * Server-level text comes first; each connector's text follows under a heading
 * named after the connector, so the agent knows which tools it applies to.
 */
function composeInstructions(connectors: Connector[], serverLevel?: string): string | undefined {
  const parts: string[] = []
  if (serverLevel != null && serverLevel.trim() !== '') parts.push(serverLevel.trim())
  for (const connector of connectors) {
    const text = connector.instructions
    if (text != null && text.trim() !== '') parts.push(`## ${connector.name}\n${text.trim()}`)
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function makeToolClass(
  connector: Connector,
  tool: ConnectorTool,
  toolName: string,
  options: MountOptions,
): new () => McpTool {
  class ConnectorToolImpl extends McpTool {
    override name(): string {
      return toolName
    }
    override description(): string {
      return tool.description ?? ''
    }
    override schema(): ZodLikeObject {
      return tool.schema
    }
    override async handle(input: Record<string, unknown>): Promise<McpToolResult> {
      const auth = (await options.credentials?.(connector.id)) ?? {}
      const ctx: ConnectorContext = { connectorId: connector.id, auth }
      return normalizeResult(await tool.handle(input, ctx))
    }
  }

  if (tool.outputSchema) {
    const outputSchema = tool.outputSchema
    ;(ConnectorToolImpl.prototype as { outputSchema?: () => ZodLikeObject }).outputSchema = () => outputSchema
  }

  const a = tool.annotations
  if (a?.readOnly) IsReadOnly(true)(ConnectorToolImpl)
  if (a?.destructive) IsDestructive(true)(ConnectorToolImpl)
  if (a?.idempotent) IsIdempotent(true)(ConnectorToolImpl)
  if (a?.openWorld) IsOpenWorld(true)(ConnectorToolImpl)

  return ConnectorToolImpl
}

/** Wrap a connector handler's return into a {@link McpToolResult}. */
function normalizeResult(result: ConnectorToolReturn): McpToolResult {
  if (isToolResult(result)) return result
  if (typeof result === 'string') return McpResponse.text(result)
  return McpResponse.json(result)
}

function isToolResult(value: unknown): value is McpToolResult {
  return !!value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)
}
