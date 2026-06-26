import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '../McpServer.js'
import type { McpTool } from '../McpTool.js'
import type { McpResource } from '../McpResource.js'
import type { McpPrompt } from '../McpPrompt.js'
import { zodToJsonSchema } from '../zod-to-json-schema.js'
import { getToolAnnotations, getResourceAnnotations } from '../decorators.js'
import { matchUriTemplate } from '../uri-template.js'
import { getMcpObservers } from './observers-accessor.js'
import { consumeToolReturn } from './consume-tool-return.js'
import { resolveOrConstruct, resolveHandleDeps, isRegistered, filterRegistered } from './handle-deps.js'

export function createSdkServer(server: McpServer): Server {
  const meta = server.metadata()
  const resolver = server._resolver()
  const sdk = new Server(
    { name: meta.name, version: meta.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )

  const tools: McpTool[] = server._tools().map((T) => resolveOrConstruct(T, resolver))
  const resources: McpResource[] = server._resources().map((R) => resolveOrConstruct(R, resolver))
  const prompts: McpPrompt[] = server._prompts().map((P) => resolveOrConstruct(P, resolver))

  // ── Tools ────────────────────────────────────────────────
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await filterRegistered(tools)).map((t) => {
      const def: Record<string, unknown> = {
        name: t.name(),
        description: t.description(),
        inputSchema: zodToJsonSchema(t.schema()),
      }
      if (t.outputSchema) {
        def['outputSchema'] = zodToJsonSchema(t.outputSchema())
      }
      const annotations = getToolAnnotations(t.constructor)
      if (annotations) {
        def['annotations'] = annotations
      }
      return def
    }),
  }))

  sdk.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find((t) => t.name() === request.params.name)
    if (!tool || !(await isRegistered(tool))) {
      return { content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }], isError: true }
    }
    const input = (request.params.arguments ?? {}) as Record<string, unknown>
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(tool, 'handle', resolver)
      const ret = tool.handle(input, ...extras as [])
      const result = await consumeToolReturn(ret, extra, request.params._meta)
      getMcpObservers()?.emit({
        kind: 'tool.called', serverName: meta.name, name: tool.name(),
        input, output: result, duration: performance.now() - start,
      })
      return { ...result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'tool.failed', serverName: meta.name, name: tool.name(),
        input, output: null, duration: performance.now() - start, error: msg,
      })
      return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
    }
  })

  // ── Resources ────────────────────────────────────────────
  const staticResources = resources.filter((r) => !r.isTemplate())
  const templateResources = resources.filter((r) => r.isTemplate())

  function decorateResource(r: McpResource): Record<string, unknown> {
    const def: Record<string, unknown> = {
      uri: r.uri(),
      name: r.uri(),
      description: r.description(),
      mimeType: r.mimeType(),
    }
    const annotations = getResourceAnnotations(r.constructor)
    if (annotations) {
      def['annotations'] = annotations
    }
    return def
  }

  sdk.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: (await filterRegistered(staticResources)).map(decorateResource),
  }))

  if (templateResources.length > 0) {
    sdk.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: (await filterRegistered(templateResources)).map((r) => {
        const def: Record<string, unknown> = {
          uriTemplate: r.uri(),
          name: r.uri(),
          description: r.description(),
          mimeType: r.mimeType(),
        }
        const annotations = getResourceAnnotations(r.constructor)
        if (annotations) {
          def['annotations'] = annotations
        }
        return def
      }),
    }))
  }

  sdk.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri

    // Try exact match first (static resources)
    let resource = staticResources.find((r) => r.uri() === uri)
    let params: Record<string, string> | undefined

    // Try template match
    if (!resource) {
      for (const tmpl of templateResources) {
        const extracted = matchUriTemplate(tmpl.uri(), uri)
        if (extracted) {
          resource = tmpl
          params = extracted
          break
        }
      }
    }

    if (!resource || !(await isRegistered(resource))) {
      throw new Error(`Unknown resource: ${uri}`)
    }
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(resource, 'handle', resolver)
      const text = await resource.handle(params, ...extras as [])
      getMcpObservers()?.emit({
        kind: 'resource.read', serverName: meta.name, name: resource.uri(),
        input: params ?? { uri }, output: text, duration: performance.now() - start,
      })
      return {
        contents: [{ uri, text, mimeType: resource.mimeType() }],
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'resource.failed', serverName: meta.name, name: resource.uri(),
        input: params ?? { uri }, output: null, duration: performance.now() - start, error: msg,
      })
      throw err
    }
  })

  // ── Prompts ──────────────────────────────────────────────
  sdk.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: (await filterRegistered(prompts)).map((p) => ({
      name: p.name(),
      description: p.description(),
      ...(p.arguments ? { arguments: Object.keys(p.arguments().shape as Record<string, unknown>).map((k) => ({ name: k, required: true })) } : {}),
    })),
  }))

  sdk.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = prompts.find((p) => p.name() === request.params.name)
    if (!prompt || !(await isRegistered(prompt))) {
      throw new Error(`Unknown prompt: ${request.params.name}`)
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>
    const start = performance.now()
    try {
      const extras = resolveHandleDeps(prompt, 'handle', resolver)
      const messages = await prompt.handle(args, ...extras as [])
      getMcpObservers()?.emit({
        kind: 'prompt.rendered', serverName: meta.name, name: prompt.name(),
        input: args, output: messages, duration: performance.now() - start,
      })
      // The MCP wire format requires `content` to be a structured object
      // (`{ type: 'text', text: string }`); McpPrompt's public API still
      // returns `content: string` for ergonomics, so we adapt on the way out.
      return {
        messages: messages.map((m) => ({
          role: m.role,
          content: { type: 'text' as const, text: m.content },
        })),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getMcpObservers()?.emit({
        kind: 'prompt.failed', serverName: meta.name, name: prompt.name(),
        input: args, output: null, duration: performance.now() - start, error: msg,
      })
      throw err
    }
  })

  return sdk
}

/** Start a server with stdio transport */
export async function startStdio(server: McpServer): Promise<void> {
  const sdk = createSdkServer(server)
  const transport = new StdioServerTransport()
  await sdk.connect(transport)
  // Stdio is process-lifetime — no detach needed; the SDK lives until exit.
  server.attachSdk(sdk)
}
