import { z } from 'zod'
import { dynamicTool } from '@gemstack/ai-sdk'
import type { Tool, ToolCallContext } from '@gemstack/ai-sdk'
import type {
  McpClientTransport, McpClientToolsOptions, StdioServerSpawn,
} from './types.js'

const CLIENT_INFO = { name: 'gemstack-ai-mcp-bridge', version: '1.0.0' } as const

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
 * Connect to a remote MCP server and surface its tools as `@gemstack/ai-sdk` `Tool`s.
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

/** A single `notifications/progress` payload, as the SDK hands it to `onprogress`. */
interface McpProgress {
  progress: number
  total?:   number
  message?: string
}

/** Tool metadata as returned by a remote MCP server's `listTools()`. */
interface RemoteTool {
  name:        string
  description?: string
  inputSchema:  Record<string, unknown>
}

/**
 * The minimal slice of the SDK's `Client` this bridge depends on. Declared
 * structurally so the union in {@link McpClientTransport} never forces a hard
 * dependency on `@modelcontextprotocol/sdk` at module load.
 */
interface MinimalClient {
  listTools(): Promise<{ tools: unknown[] }>
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { onprogress?: (p: McpProgress) => void },
  ): Promise<{ content: unknown[]; isError?: boolean }>
  close(): Promise<void>
}

async function resolveClient(
  transport: McpClientTransport,
): Promise<{ client: MinimalClient; ownsClient: boolean }> {
  // Already a Client instance — duck-type check for `callTool` + `listTools`.
  // The `unknown` double-cast is deliberate: `transport` is typed `object` (we
  // can't name the SDK's Client type without a hard dependency on it), so we
  // narrow structurally and assert to our MinimalClient shape.
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
  await connectOrClose(client as unknown as ConnectableClient, sdkTransport)
  return { client, ownsClient: true }
}

/** The slice of the SDK `Client` the connect path needs. */
interface ConnectableClient {
  connect(t: unknown): Promise<void>
  close():             Promise<void>
}

/**
 * Connect, tearing down the transport when the handshake fails. The SDK does not
 * clean up if `transport.start()` rejects, and only fires an unawaited `close()`
 * on an initialize failure, so a stdio subprocess or HTTP session can outlive a
 * failed `connect()` and a retrying caller leaks one per attempt.
 *
 * @internal Exported for tests. Not re-exported from the package entry.
 */
export async function connectOrClose(client: ConnectableClient, sdkTransport: unknown): Promise<void> {
  try {
    await client.connect(sdkTransport)
  } catch (err) {
    await safeClose(client)
    // Also close the transport directly: on an early failure the client may not own it yet.
    await safeCloseTransport(sdkTransport)
    throw err
  }
}

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

async function safeClose(client: { close(): Promise<void> }): Promise<void> {
  try { await client.close() } catch { /* best-effort */ }
}

async function safeCloseTransport(sdkTransport: unknown): Promise<void> {
  const close = (sdkTransport as { close?: () => unknown } | null | undefined)?.close
  if (typeof close !== 'function') return
  try { await close.call(sdkTransport) } catch { /* best-effort */ }
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
      const pending: McpProgress[] = []
      let wake: (() => void) | undefined
      let settled = false
      let failed  = false
      let result:  { content: unknown[]; isError?: boolean } | undefined
      let failure: unknown

      // Never rejects — the outcome is replayed below, once the queue is drained.
      const call = client.callTool(
        { name: remote.name, arguments: (input ?? {}) as Record<string, unknown> },
        undefined,
        { onprogress: (p) => { pending.push(p); wake?.() } },
      ).then(
        (r) => { result  = r },
        (e) => { failed = true; failure = e },
      ).finally(() => { settled = true; wake?.() })

      // Yield each progress event as it lands, so a consumer sees tool-update
      // chunks while the remote tool is still running. The last drain still runs
      // before the return, so every chunk keeps landing ahead of the tool-result.
      for (;;) {
        while (pending.length > 0) yield pending.shift()!
        if (settled) break
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }

      await call
      if (failed) throw failure
      return mcpContentToString(result!)
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
