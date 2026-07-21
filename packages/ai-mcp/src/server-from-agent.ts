import { z } from 'zod'
import type { Agent } from '@gemstack/ai-sdk'
import type { HasTools, Tool, ToolCallContext } from '@gemstack/ai-sdk'
import type { McpServerFromAgentOptions } from './types.js'

/**
 * Wrap an `Agent` class as an MCP server. External MCP clients (Claude Desktop,
 * Cursor, etc.) can connect to it like any other MCP server.
 *
 * Returns an `McpServer` from `@modelcontextprotocol/sdk` — connect it with the
 * SDK's stdio / HTTP transports:
 *
 * ```ts
 * import { mcpServerFromAgent } from '@gemstack/ai-mcp'
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
 *
 * const server = await mcpServerFromAgent(MyAgent)
 * await server.connect(new StdioServerTransport())
 * ```
 *
 * Three exposure modes via `opts.expose`:
 * - `'tools'` (default) — one MCP tool per `agent.tools()` entry
 * - `'agent'` — one MCP tool that runs the whole agent (`prompt(text) → text`)
 * - `'both'` — expose individual tools and the agent prompt-tool side by side
 */
export async function mcpServerFromAgent(
  AgentClass: new () => Agent,
  opts: McpServerFromAgentOptions = {},
): Promise<unknown> {
  const expose = opts.expose ?? 'tools'

  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js') as {
    McpServer: new (info: { name: string; version: string }, opts?: { instructions?: string }) => SdkMcpServer
  }

  const agent = new AgentClass()
  const instructions = opts.instructions ?? safeInstructions(agent)
  const name    = opts.name    ?? `${AgentClass.name}Server`
  const version = opts.version ?? '1.0.0'

  const server = new McpServer(
    { name, version },
    instructions !== undefined ? { instructions } : {},
  )

  if (expose === 'tools' || expose === 'both') {
    // `tools()` is opt-in via the HasTools interface — abstract `Agent` doesn't
    // declare it. Cast and tolerate absence gracefully (subclass without tools()
    // returns no tools but the agent prompt-tool path still works).
    const hasTools = agent as unknown as HasTools
    const toolList = typeof hasTools.tools === 'function' ? hasTools.tools() : []
    for (const tool of toolList) {
      registerAgentToolOnServer(server, tool)
    }
  }

  if (expose === 'agent' || expose === 'both') {
    registerAgentPromptToolOnServer(server, AgentClass, opts.agentToolName ?? AgentClass.name)
  }

  return server
}

// ─── Internals ───────────────────────────────────────────────────

/** Minimal shape we depend on from the SDK's `McpServer`. */
interface SdkMcpServer {
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown },
    callback: (input: unknown, ctx?: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
  ): unknown
  connect(transport: unknown): Promise<void>
}

function registerAgentToolOnServer(server: SdkMcpServer, tool: Tool): void {
  const name        = tool.definition.name
  const description = tool.definition.description

  // Pass the zod schema as a single AnySchema (the SDK's `inputSchema` field
  // accepts either a ZodRawShape record or a single zod schema). The callback
  // then receives `input: unknown` which is what the agent tool expects too.
  server.registerTool(
    name,
    { description, inputSchema: tool.definition.inputSchema },
    async (input: unknown) => {
      const result = await runAgentTool(tool, input)
      return { content: [{ type: 'text' as const, text: stringifyResult(result) }] }
    },
  )
}

function registerAgentPromptToolOnServer(
  server: SdkMcpServer,
  AgentClass: new () => Agent,
  toolName: string,
): void {
  const promptShape = { prompt: z.string().describe('User message for the agent') }

  server.registerTool(
    toolName,
    {
      description: `Run the ${AgentClass.name} agent with a prompt and return its response`,
      inputSchema: promptShape,
    },
    async (input: unknown) => {
      const args = (input ?? {}) as { prompt?: unknown }
      if (typeof args.prompt !== 'string') {
        return { content: [{ type: 'text' as const, text: '[error] Agent prompt-tool requires { prompt: string }' }] }
      }
      const agent = new AgentClass()
      const response = await agent.prompt(args.prompt)
      return { content: [{ type: 'text' as const, text: response.text ?? '' }] }
    },
  )
}

/** True only for an async generator: a Promise has neither `next` nor `Symbol.asyncIterator`. */
function isAsyncGenerator(v: unknown): v is AsyncGenerator<unknown, unknown, void> {
  const maybe = v as { next?: unknown; [Symbol.asyncIterator]?: unknown } | null
  return maybe != null
    && typeof maybe.next === 'function'
    && typeof maybe[Symbol.asyncIterator] === 'function'
}

async function runAgentTool(tool: Tool, input: unknown): Promise<unknown> {
  if (!tool.execute) {
    throw new Error(`mcpServerFromAgent: tool "${tool.definition.name}" has no execute fn (client-only tool — cannot be exposed via MCP)`)
  }
  const out = (tool.execute as (input: unknown, ctx?: ToolCallContext) => unknown)(input)
  // Duck-type the generator rather than testing `out instanceof Promise`: a
  // `.server()` fn may legally return a bare value or a non-native thenable,
  // and both would otherwise be mistaken for a generator and die on `.next()`.
  if (!isAsyncGenerator(out)) return await out

  // Generator path — drain progress yields silently and return the final value.
  // (MCP forwards progress via `notifications/progress`; the agent loop's
  //  tool-update chunks don't map cleanly without a progressToken from the
  //  caller, so we drop them in v1. Future enhancement: forward progress when
  //  the calling MCP client supplied a progressToken.)
  const iter = out as AsyncGenerator<unknown, unknown, void>
  let next = await iter.next()
  while (!next.done) next = await iter.next()
  return next.value
}

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === undefined || result === null) return ''
  if (typeof result === 'object') {
    try { return JSON.stringify(result, null, 2) } catch { return String(result) }
  }
  return String(result)
}

/**
 * Read the agent's instructions for the server's advertised `instructions`.
 * This is best-effort optional metadata: `instructions()` may legitimately
 * depend on per-request state that isn't available here, so a throw is treated
 * as "no instructions" rather than failing server creation. Pass
 * `opts.instructions` explicitly to bypass this.
 */
function safeInstructions(agent: Agent): string | undefined {
  try {
    const out = agent.instructions()
    return typeof out === 'string' && out.length > 0 ? out : undefined
  } catch { return undefined }
}

