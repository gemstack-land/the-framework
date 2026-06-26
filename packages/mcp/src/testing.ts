import type { McpServer, McpServerOptions } from './McpServer.js'
import type { McpTool, McpToolResult, McpToolProgress } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt, McpPromptMessage } from './McpPrompt.js'
// Import from the cheap sibling modules directly so the test client doesn't
// pull `@modelcontextprotocol/sdk` through the `runtime.ts` barrel.
import { resolveOrConstruct, resolveHandleDeps, isRegistered, filterRegistered } from './runtime/handle-deps.js'
import { consumeToolReturn } from './runtime/consume-tool-return.js'
import { getToolAnnotations, getResourceAnnotations, type ToolAnnotations, type ResourceAnnotations } from './decorators.js'
import type { McpResolver } from './resolver.js'

export interface McpTestClientOptions {
  /** DI resolver for `@Handle()` dependencies + primitive construction. */
  resolver?: McpResolver
}

export class McpTestClient {
  private tools: McpTool[]
  private resources: McpResource[]
  private prompts: McpPrompt[]
  private resolver: McpResolver | undefined

  constructor(ServerClass: new (options?: McpServerOptions) => McpServer, options: McpTestClientOptions = {}) {
    this.resolver = options.resolver
    const server = new ServerClass(this.resolver ? { resolver: this.resolver } : {})
    this.tools     = server._tools().map((T) => resolveOrConstruct(T, this.resolver))
    this.resources = server._resources().map((R) => resolveOrConstruct(R, this.resolver))
    this.prompts   = server._prompts().map((P) => resolveOrConstruct(P, this.resolver))
  }

  /**
   * Invoke a tool by name. Handles both plain async tools and streaming
   * generator tools — for the latter, progress yields are captured if a
   * collector is supplied via `onProgress`, otherwise dropped silently.
   */
  async callTool(
    name: string,
    input: Record<string, unknown> = {},
    onProgress?: (p: McpToolProgress) => void,
  ): Promise<McpToolResult> {
    const tool = this.tools.find((t) => t.name() === name)
    if (!tool || !(await isRegistered(tool))) throw new Error(`Tool "${name}" not found`)
    const extras = resolveHandleDeps(tool, 'handle', this.resolver)
    const ret = tool.handle(input, ...extras as [])
    const extra = onProgress
      ? {
          sendNotification: async (n: { method: string; params: Record<string, unknown> }) => {
            if (n.method === 'notifications/progress') {
              const { progressToken: _t, ...rest } = n.params as Record<string, unknown>
              onProgress(rest as unknown as McpToolProgress)
            }
          },
        }
      : undefined
    // Pass a synthetic progressToken so the runtime forwards yields to onProgress.
    return consumeToolReturn(ret, extra, onProgress ? { progressToken: 'test' } : undefined)
  }

  async listTools(): Promise<Array<{ name: string; description: string; annotations?: ToolAnnotations }>> {
    return (await filterRegistered(this.tools)).map((t) => {
      const annotations = getToolAnnotations(t.constructor)
      return {
        name: t.name(),
        description: t.description(),
        ...(annotations ? { annotations } : {}),
      }
    })
  }

  async listResources(): Promise<Array<{ uri: string; description: string; annotations?: ResourceAnnotations }>> {
    return (await filterRegistered(this.resources)).map((r) => {
      const annotations = getResourceAnnotations(r.constructor)
      return {
        uri: r.uri(),
        description: r.description(),
        ...(annotations ? { annotations } : {}),
      }
    })
  }

  async listPrompts(): Promise<Array<{ name: string; description: string }>> {
    return (await filterRegistered(this.prompts)).map((p) => ({
      name: p.name(),
      description: p.description(),
    }))
  }

  async readResource(uri: string): Promise<string> {
    const resource = this.resources.find((r) => r.uri() === uri)
    if (!resource || !(await isRegistered(resource))) throw new Error(`Resource "${uri}" not found`)
    return resource.handle()
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<McpPromptMessage[]> {
    const prompt = this.prompts.find((p) => p.name() === name)
    if (!prompt || !(await isRegistered(prompt))) throw new Error(`Prompt "${name}" not found`)
    return prompt.handle(args)
  }

  assertToolExists(name: string): void {
    if (!this.tools.some((t) => t.name() === name)) {
      throw new Error(`Expected tool "${name}" to exist, but it was not found`)
    }
  }

  assertToolCount(expected: number): void {
    if (this.tools.length !== expected) {
      throw new Error(`Expected ${expected} tools, but found ${this.tools.length}`)
    }
  }

  assertResourceExists(uri: string): void {
    if (!this.resources.some((r) => r.uri() === uri)) {
      throw new Error(`Expected resource "${uri}" to exist, but it was not found`)
    }
  }

  assertResourceCount(expected: number): void {
    if (this.resources.length !== expected) {
      throw new Error(`Expected ${expected} resources, but found ${this.resources.length}`)
    }
  }

  assertPromptExists(name: string): void {
    if (!this.prompts.some((p) => p.name() === name)) {
      throw new Error(`Expected prompt "${name}" to exist, but it was not found`)
    }
  }

  assertPromptCount(expected: number): void {
    if (this.prompts.length !== expected) {
      throw new Error(`Expected ${expected} prompts, but found ${this.prompts.length}`)
    }
  }
}
