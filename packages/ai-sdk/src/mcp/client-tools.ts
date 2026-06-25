import { z } from 'zod'
import { dynamicTool } from '../tool.js'
import type { Tool, ToolCallContext } from '../types.js'
import type {
  McpClientTransport, McpClientToolsOptions, StdioServerSpawn,
} from './types.js'

const CLIENT_INFO = { name: 'rudderjs-ai-mcp-bridge', version: '1.0.0' } as const

/**
 * The result of `mcpClientTools()` — an array of `Tool`s that also carries a
 * `close()` method when this call owns the underlying client lifecycle.
 *
 * Spreading this into `tools()` works because the extra method is non-enumerable
 * (and only present when relevant) — the agent loop iterates with for-of which
 * skips it.
 */
export interface McpClientToolsHandle extends ReadonlyArray<Tool> {
  /** Disconnect the underlying MCP client. No-op when an external client was passed in. */
  close?: () => Promise<void>
}

/**
 * Connect to a remote MCP server and surface its tools as Rudder `Tool`s.
 *
 * Three transport shapes are accepted:
 *
 * ```ts
 * // (a) HTTP — string URL or URL instance
 * const t = await mcpClientTools('https://api.example.com/mcp')
 *
 * // (b) Local stdio subprocess
 * const t = await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })
 *
 * // (c) Already-connected SDK Client (caller owns lifecycle)
 * const t = await mcpClientTools(myClient)
 * ```
 *
 * The returned array exposes a `close()` method when this call owns the client
 * (cases a + b). Pass it back so the subprocess / HTTP session can shut down
 * cleanly when your agent is done.
 *
 * The remote server's `inputSchema` (JSON Schema) ships through to providers
 * via `ToolDefinitionOptions.jsonSchema` — no zod conversion in either direction.
 */
export async function mcpClientTools(
  transport: McpClientTransport,
  opts: McpClientToolsOptions = {},
): Promise<McpClientToolsHandle> {
  const streaming  = opts.streaming ?? true
  const namePrefix = opts.namePrefix ?? ''

  const { client, ownsClient } = await resolveClient(transport)

  let toolList: Array<RemoteTool>
  try {
    const listed = await client.listTools()
    toolList = (listed.tools as RemoteTool[]).filter(t =>
      opts.filter ? opts.filter(t.name) : true,
    )
  } catch (err) {
    if (ownsClient) await safeClose(client)
    throw err
  }

  const tools: Tool[] = toolList.map(t => buildTool(client, t, namePrefix, streaming))

  const handle: McpClientToolsHandle = ownsClient
    ? Object.defineProperty([...tools] as Tool[], 'close', {
        value: () => safeClose(client),
        enumerable: false,
        writable:   false,
      }) as McpClientToolsHandle
    : tools

  return handle
}

// ─────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────

interface RemoteTool {
  name:        string
  description?: string
  inputSchema:  Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

interface MinimalClient {
  listTools(): Promise<{ tools: unknown[] }>
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { onprogress?: (p: { progress: number; total?: number; message?: string }) => void },
  ): Promise<{ content: unknown[]; isError?: boolean }>
  close(): Promise<void>
}

async function resolveClient(
  transport: McpClientTransport,
): Promise<{ client: MinimalClient; ownsClient: boolean }> {
  // Already a Client instance — duck-type check for `callTool` + `listTools`.
  if (typeof transport === 'object' && transport !== null && 'callTool' in transport && 'listTools' in transport) {
    return { client: transport as unknown as MinimalClient, ownsClient: false }
  }

  // Lazy-load the SDK so apps that don't import @gemstack/ai-sdk/mcp don't pay for it.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js') as {
    Client: new (info: { name: string; version: string }) => MinimalClient
      & { connect(t: unknown): Promise<void> }
  }

  const sdkTransport = await buildTransport(transport)

  const client = new Client(CLIENT_INFO)
  await (client as unknown as { connect(t: unknown): Promise<void> }).connect(sdkTransport)
  return { client, ownsClient: true }
}

async function buildTransport(transport: Exclude<McpClientTransport, object>): Promise<unknown>
async function buildTransport(transport: McpClientTransport): Promise<unknown>
async function buildTransport(transport: McpClientTransport): Promise<unknown> {
  if (typeof transport === 'string' || transport instanceof URL) {
    const url = transport instanceof URL ? transport : new URL(transport)
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js') as {
      StreamableHTTPClientTransport: new (url: URL) => unknown
    }
    return new StreamableHTTPClientTransport(url)
  }

  if (typeof transport === 'object' && transport !== null && 'command' in transport) {
    const spawn = transport as StdioServerSpawn
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js') as {
      StdioClientTransport: new (params: { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) => unknown
    }
    return new StdioClientTransport({
      command: spawn.command,
      ...(spawn.args !== undefined ? { args: [...spawn.args] } : {}),
      ...(spawn.env !== undefined  ? { env:  spawn.env  } : {}),
      ...(spawn.cwd !== undefined  ? { cwd:  spawn.cwd  } : {}),
    })
  }

  throw new Error(`mcpClientTools: unsupported transport shape: ${typeof transport}`)
}

async function safeClose(client: MinimalClient): Promise<void> {
  try { await client.close() } catch { /* best-effort */ }
}

function buildTool(
  client:     MinimalClient,
  remote:     RemoteTool,
  namePrefix: string,
  streaming:  boolean,
): Tool {
  const localName = namePrefix + remote.name
  const builder = dynamicTool({
    name:        localName,
    description: remote.description ?? '',
    inputSchema: z.unknown(),  // placeholder — real shape lives in jsonSchema
    jsonSchema:  remote.inputSchema,
  })

  if (streaming) {
    const built = builder.server(async function* (input: unknown, _ctx?: ToolCallContext) {
      const collected: Array<{ progress: number; total?: number; message?: string }> = []
      const result = await client.callTool(
        { name: remote.name, arguments: (input ?? {}) as Record<string, unknown> },
        undefined,
        { onprogress: (p) => collected.push(p) },
      )
      // SDK delivers progress notifications synchronously into onprogress during
      // the request lifetime, so by the time we're here all progress events have
      // arrived. Yielding them before returning preserves the observable order
      // (tool-update chunks land before tool-result).
      for (const p of collected) yield p
      return mcpContentToString(result)
    })
    return built as unknown as Tool
  }

  const built = builder.server(async (input: unknown) => {
    const result = await client.callTool(
      { name: remote.name, arguments: (input ?? {}) as Record<string, unknown> },
    )
    return mcpContentToString(result)
  })
  return built as unknown as Tool
}

/**
 * Flatten an MCP tool result into a string for the agent's `tool_result` slot.
 * Text blocks concatenate; image / resource blocks become bracketed placeholders
 * so the model knows something non-text was returned.
 */
function mcpContentToString(result: { content: unknown[]; isError?: boolean }): string {
  const parts: string[] = []
  for (const block of result.content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b['type'] === 'text' && typeof b['text'] === 'string') {
      parts.push(b['text'])
    } else if (b['type'] === 'image') {
      parts.push(`[image: ${b['mimeType'] ?? 'unknown mime'}]`)
    } else if (b['type'] === 'resource' || b['type'] === 'resource_link') {
      const ref = b['resource'] && typeof b['resource'] === 'object'
        ? (b['resource'] as Record<string, unknown>)['uri']
        : b['uri']
      parts.push(`[resource: ${ref ?? 'unknown'}]`)
    } else if (b['type']) {
      parts.push(`[${b['type']}]`)
    }
  }
  const text = parts.join('\n').trim()
  if (result.isError) return `[error] ${text || 'Tool reported an error'}`
  return text || '(empty result)'
}
