import 'reflect-metadata'
import {
  McpServer, McpTool, McpResource, McpPrompt, McpResponse,
  Name, Version, Instructions, Description, Handle,
  createResolver,
  type McpResolver, type VerifyToken,
} from '@gemstack/mcp'
import { z } from 'zod'

// A plain service. No framework, no container, no AI runtime. The tool below
// asks for it by type via @Handle, and the server's resolver provides it.
export class Greeter {
  greet(name: string): string {
    return `Hello, ${name}! Served by @gemstack/mcp with zero framework.`
  }
}

@Description('Greet someone by name')
class GreetTool extends McpTool {
  schema() {
    return z.object({ name: z.string().describe('Who to greet') })
  }

  // @Handle injects the Greeter (resolved from the server's resolver) after the
  // validated input. The token is explicit, so no decorator metadata is needed.
  @Handle(Greeter)
  async handle(input: { name: string }, greeter: Greeter) {
    return McpResponse.text(greeter.greet(input.name))
  }
}

@Description('The server version, exposed as a readable resource')
class VersionResource extends McpResource {
  uri() { return 'info://version' }
  async handle() { return '1.0.0' }
}

@Description('A reusable greeting prompt')
class GreetingPrompt extends McpPrompt {
  arguments() { return z.object({ name: z.string() }) }
  async handle(args: { name: string }) {
    return [{ role: 'user' as const, content: `Please greet ${args.name} warmly.` }]
  }
}

@Name('quickstart')
@Version('1.0.0')
@Instructions('A demo MCP server: one tool, one resource, one prompt. No Rudder, no AI runtime.')
class QuickstartServer extends McpServer {
  protected tools = [GreetTool]
  protected resources = [VersionResource]
  protected prompts = [GreetingPrompt]
}

// Build a fully-wired server instance. The resolver is INSTANCE-SCOPED: it is
// passed at construction and never read off a global. createResolver() needs no
// DI container; to use one, implement McpResolver = { resolve(token) } over it
// (see the README for an Awilix/tsyringe adapter).
export function makeServer(): McpServer {
  const resolver: McpResolver = createResolver().register(Greeter, new Greeter())
  return new QuickstartServer({ resolver })
}

// ─── OAuth 2.1 ────────────────────────────────────────────
// The core is auth-agnostic: you supply verifyToken. Here we accept a single
// demo token and grant it the read scope. In production, validate the JWT
// (signature, expiry, revocation) and return its real claims, or null/throw.
export const REQUIRED_SCOPES = ['mcp.read']
export const DEMO_TOKEN = 'demo-token'

export const verifyToken: VerifyToken = (jwt) => {
  if (jwt === DEMO_TOKEN) return { sub: 'demo-user', scopes: ['mcp.read'] }
  return null
}
