# @gemstack/mcp

An agent-agnostic framework for **authoring Model Context Protocol (MCP) servers** in TypeScript: declare tools, resources, and prompts as classes; serve them over a framework-neutral HTTP handler or stdio; protect them with OAuth 2.1. No framework required.

This is the graduation of the mature `@rudderjs/mcp` server framework into a standalone, dependency-light package. Its only runtime dependencies are `@modelcontextprotocol/sdk`, `zod`, and `reflect-metadata`.

## Which MCP package do I want?

There are two MCP packages in GemStack, on opposite axes — don't conflate them:

| Package | Axis | Use it to… |
|---|---|---|
| **`@gemstack/mcp`** (this) | **server authoring** | Build an MCP *server*: hand-author tools/resources/prompts and serve them. Agent-agnostic — depends on no AI runtime. |
| `@gemstack/ai-mcp` | agent ↔ MCP bridge | Consume remote MCP tools as `@gemstack/ai-sdk` Agent tools, or expose a single Agent as an MCP server. Depends on `@gemstack/ai-sdk`. |

## Install

```bash
npm install @gemstack/mcp
```

`reflect-metadata` must be imported once at your entry point (for the decorators):

```ts
import 'reflect-metadata'
```

## Quick start

Define a tool and a server:

```ts
import { McpServer, McpTool, McpResponse, Name, Description } from '@gemstack/mcp'
import { z } from 'zod'

@Description('Echo a message back to the caller')
class EchoTool extends McpTool {
  schema() { return z.object({ message: z.string() }) }
  async handle(input: { message: string }) {
    return McpResponse.text(input.message)
  }
}

@Name('demo')
class DemoServer extends McpServer {
  protected tools = [EchoTool]
}
```

Serve it over raw `node:http` — no framework involved:

```ts
import { createServer } from 'node:http'
import { createMcpHttpHandler } from '@gemstack/mcp'

const handler = createMcpHttpHandler(new DemoServer())
createServer((req, res) => { void handler(req, res) }).listen(3000)
```

`createMcpHttpHandler` returns a plain `(req, res)` handler, so it also mounts on Express/Connect. For Hono, Vike, or any Fetch-style runtime, use `createWebRequestHandler` from `@gemstack/mcp/runtime` (`(request: Request) => Promise<Response>`):

```ts
import { Hono } from 'hono'
import { createWebRequestHandler } from '@gemstack/mcp/runtime'

const handler = createWebRequestHandler(new DemoServer())
const app = new Hono()
app.all('/mcp', (c) => handler(c.req.raw))
```

For a CLI/stdio server, use `startStdio` from the same subpath.

> **Runnable example:** [`examples/mcp-quickstart`](../../examples/mcp-quickstart) is a complete, framework-neutral server (tool + resource + prompt, `@Handle` DI, OAuth 2.1) served over both `node:http` and Hono, with a CI smoke test, and **zero `@rudderjs/*` packages**.

### Resources and prompts

```ts
import { McpResource, McpPrompt } from '@gemstack/mcp'

class VersionResource extends McpResource {
  uri() { return 'info://version' }
  async handle() { return '1.0.0' }
}

class GreetPrompt extends McpPrompt {
  arguments() { return z.object({ name: z.string() }) }
  async handle(args: { name: string }) {
    return [{ role: 'user' as const, content: `Hello ${args.name}` }]
  }
}
```

URI templates (`weather://location/{city}`) are matched and their params passed to `handle(params)`.

## Dependency injection — `@Handle`

A tool/resource/prompt method can ask for dependencies beyond its first argument. Mark it with `@Handle(...)` and construct the server with a **resolver**:

```ts
import { McpServer, McpTool, McpResponse, Handle, createResolver } from '@gemstack/mcp'

class Logger { info(msg: string) { console.log(msg) } }

class LogTool extends McpTool {
  schema() { return z.object({ message: z.string() }) }
  @Handle(Logger)
  async handle(input: { message: string }, log: Logger) {
    log.info(input.message)
    return McpResponse.text('logged')
  }
}

class LogServer extends McpServer { protected tools = [LogTool] }

const resolver = createResolver().register(Logger, new Logger())
const server = new LogServer({ resolver })
```

The resolver is **instance-scoped** — passed at construction, never read off a global. Wire it to any container (Awilix, tsyringe, InversifyJS, a framework binding) with a one-function adapter implementing `McpResolver = { resolve(token): unknown }`:

```ts
import { createContainer, asValue } from 'awilix'
import type { McpResolver } from '@gemstack/mcp'

const container = createContainer().register({ logger: asValue(new Logger()) })
const resolver: McpResolver = { resolve: (token) => container.resolve((token as { name: string }).name) }
new LogServer({ resolver })
```

If a `@Handle` method requests a dependency and no resolver is provided — or the resolver yields `undefined` — the call fails loudly, naming the member and token; it never injects `undefined`.

## OAuth 2.1

Protect a web endpoint with bearer tokens. The core is auth-agnostic: you supply a `verifyToken` that validates the JWT (signature, expiry, revocation) and returns its claims, or `null`/throws when invalid.

```ts
import { oauth2McpMiddleware } from '@gemstack/mcp'

const mw = oauth2McpMiddleware('/mcp', {
  scopes: ['mcp.read'],
  verifyToken: async (jwt) => {
    // validate however you like; return claims or null
    return { sub: 'user-1', scopes: ['mcp.read'] }
  },
})
```

On success the verified claims are attached to the request as `req.mcpAuth`. `registerOAuth2Metadata(...)` emits the RFC 9728 protected-resource metadata document.

## Testing

`McpTestClient` exercises a server's tools/resources/prompts in-process, with no transport:

```ts
import { McpTestClient } from '@gemstack/mcp/testing'

const client = new McpTestClient(DemoServer)
const result = await client.callTool('echo', { message: 'hi' })

// With DI:
const client2 = new McpTestClient(LogServer, { resolver })
```

## Observers

Subscribe to structured tool/resource/prompt events (for tracing/telemetry) via `@gemstack/mcp/observers`.

## License

MIT
