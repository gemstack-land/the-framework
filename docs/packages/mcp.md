# @gemstack/mcp

An agent-agnostic framework for **authoring Model Context Protocol (MCP) servers** in TypeScript: declare tools, resources, and prompts as classes; serve them over a framework-neutral HTTP handler or stdio; protect them with OAuth 2.1. No framework required.

Once you author an MCP server, an external AI agent (Claude Code, Cursor, Windsurf, any MCP-compatible client) can query your database, kick off jobs, fetch documents, and run domain-specific commands without leaving its chat UI.

It is standalone and dependency-light: its only runtime dependencies are `@modelcontextprotocol/sdk`, `zod`, and `reflect-metadata`. (It graduated from the mature `@rudderjs/mcp` server framework, re-versioned under the GemStack umbrella.)

## Which MCP package do I want?

There are two MCP packages in GemStack, on opposite axes; don't conflate them:

| Package | Axis | Use it to... |
|---|---|---|
| **`@gemstack/mcp`** (this) | **server authoring** | Build an MCP *server*: hand-author tools/resources/prompts and serve them. Agent-agnostic, depends on no AI runtime. |
| [`@gemstack/ai-mcp`](/packages/ai-mcp) | agent / MCP bridge | Consume remote MCP tools as [`@gemstack/ai-sdk`](/packages/ai-sdk/) Agent tools, or expose a single Agent as an MCP server. Depends on `@gemstack/ai-sdk`. |

## Install

```bash
npm install @gemstack/mcp
```

`reflect-metadata` must be imported once at your entry point (the decorators rely on it):

```ts
import 'reflect-metadata'
```

## Quick start

Define a tool and a server. You register the tool **classes**, not instances:

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

A tool's name is derived from its class name (kebab-case, minus a trailing `Tool`), so `EchoTool` is `echo` and `CurrentWeatherTool` is `current-weather`. Override `name()` or use `@Name` to set it explicitly.

## The three primitives

An MCP server exposes three kinds of capabilities:

- **Tools** (`McpTool`) - functions the agent calls (most common).
- **Resources** (`McpResource`) - data the agent reads (URIs the agent can fetch).
- **Prompts** (`McpPrompt`) - reusable prompt templates the agent loads.

A server declares each as an array of classes:

```ts
import { McpServer, Name } from '@gemstack/mcp'

@Name('weather')
class WeatherServer extends McpServer {
  protected tools     = [CurrentWeatherTool, ForecastTool]
  protected resources = [LatestReport]
  protected prompts   = [WeatherSummaryPrompt]
}
```

Server identity comes from `@Name`, `@Version`, and `@Instructions` decorators (or by overriding `metadata()`); `version` defaults to `'1.0.0'` and `name` to the class name.

## Tools with rich input

Zod schemas drive what the agent sees:

```ts
@Description('Search posts by query string and tag.')
class SearchPostsTool extends McpTool {
  schema() {
    return z.object({
      query: z.string().describe('Full-text search query'),
      tags:  z.array(z.string()).optional().describe('Filter by tags'),
      limit: z.number().int().min(1).max(50).default(10),
    })
  }

  async handle({ query, tags, limit }) {
    const posts = await searchPosts(query, { tags, limit })
    return McpResponse.json(posts)
  }
}
```

`McpResponse` builds the result shape a tool's `handle()` returns:

- `McpResponse.text(string)` - a plain-text result.
- `McpResponse.json(data)` - a structured result, serialized as pretty-printed JSON text.
- `McpResponse.error(message)` - an error result (`isError: true`, prefixed with `Error: `). The client sees a failed tool call rather than a thrown exception, so prefer it for expected, user-facing failures (validation, not-found) and reserve throwing for unexpected faults.

A tool may also declare an optional `outputSchema()` to advertise the structure of its response.

## Dependency injection - `@Handle`

A tool / resource / prompt method can ask for dependencies beyond its first argument. Mark the method with `@Handle(...)` and construct the server with a **resolver**:

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

The resolver is **instance-scoped**: it is passed at construction and never read off a global. Wire it to any container (Awilix, tsyringe, InversifyJS) with a one-function adapter implementing `McpResolver = { resolve(token): unknown }`:

```ts
import { createContainer, asValue } from 'awilix'
import type { McpResolver } from '@gemstack/mcp'

const container = createContainer().register({ logger: asValue(new Logger()) })
const resolver: McpResolver = { resolve: (token) => container.resolve((token as { name: string }).name) }
new LogServer({ resolver })
```

If a `@Handle` method requests a dependency and no resolver is provided (or the resolver yields `undefined`), the call fails loudly, naming the member and token; it never injects `undefined`.

> The `@Description` decorator works on classes, and `@Handle` works on `handle()` with explicit tokens. Other method-level decorators that need `design:paramtypes` are unreliable under bundlers such as Vite, so the supported method decorator (`@Handle`) takes its tokens explicitly rather than relying on reflected parameter types.

## Conditional registration

Hide a primitive when a feature flag is off, in dev mode, or under any other static condition, via `shouldRegister()`:

```ts
class ExperimentalTool extends McpTool {
  schema() { return z.object({}) }
  async handle() { return McpResponse.text('experimental') }
  shouldRegister() { return process.env.FEATURE_EXPERIMENTAL === 'true' }
}
```

Returning `false` hides the primitive from `tools/list` **and** blocks `tools/call` (returning an "unknown tool" error), so a direct call can't bypass the gate. The same hook works on `McpResource` and `McpPrompt`, and async hooks are supported. The hook runs with no arguments today; per-request gating (auth-scoped tools) is roadmap work.

## Behavior annotations

Tools may carry MCP-spec hints that clients use to decide whether to auto-approve, batch, or sandbox a call. Apply them as decorators:

```ts
import { IsReadOnly, IsDestructive, IsIdempotent, IsOpenWorld } from '@gemstack/mcp'

@IsReadOnly() @IsIdempotent()  class GetUserTool extends McpTool { /* ... */ }
@IsDestructive() @IsOpenWorld() class DeleteFileTool extends McpTool { /* ... */ }
```

Both `true` and `false` carry meaning per the spec, so the decorators take an explicit value: `@IsReadOnly()` is `true`, `@IsReadOnly(false)` is `false`, and no decorator omits the hint entirely. The hints are advisory; clients still apply their own policy.

Resources accept three protocol-level annotations: `@Audience('user' | 'assistant')`, `@Priority(0..1)`, and `@LastModified(string | Date)`. Clients use them to rank and surface resources in their UI.

## Streaming progress

For long-running tools, stream progress back to the agent with an async-generator `handle()`:

```ts
async *handle({ url }) {
  yield { progress: 0,  message: 'Fetching...' }
  const html = await fetchUrl(url)
  yield { progress: 50, message: 'Parsing...' }
  const text = parseHtml(html)
  yield { progress: 100, message: 'Done' }
  return McpResponse.text(text)
}
```

An `async function*` handler yields `McpToolProgress` objects (`{ progress, total?, message? }`) and returns the final result. The runtime forwards the yields as `notifications/progress` when the calling client supplied a `progressToken`; a streaming tool that runs without one still executes, and the yields are dropped silently. The handler does not take a "send" callback parameter (it mirrors the `@gemstack/ai-sdk` streaming-tool pattern).

## Resources and prompts

```ts
import { McpResource, McpPrompt } from '@gemstack/mcp'

@Description('Latest weather report')
class LatestReport extends McpResource {
  uri() { return 'weather://latest' }
  async handle() { return await fetchLatestReport() }   // returns a plain string
}

@Description('Compose a weather summary')
class WeatherSummaryPrompt extends McpPrompt {
  arguments() { return z.object({ location: z.string() }) }
  async handle({ location }) {
    return [{ role: 'user' as const, content: `Summarize today's weather in ${location}.` }]
  }
}
```

A resource's `handle()` returns a plain string (its body); a prompt's `handle()` returns an array of `{ role, content }` messages (`McpPromptMessage[]`). Resources can use URI templates: `weather://location/{city}` is matched against `weather://location/paris` and exposes `{ city: 'paris' }` to `handle(params)`.

## Exposing the server

The package ships framework-neutral handlers so you can serve a server over raw `node:http`, any Fetch-style runtime, or stdio, with no framework in the path.

### Raw `node:http` (and Express / Connect)

`createMcpHttpHandler` returns a plain `(req, res)` handler over the MCP Streamable HTTP transport:

```ts
import { createServer } from 'node:http'
import { createMcpHttpHandler } from '@gemstack/mcp'

const handler = createMcpHttpHandler(new DemoServer())
createServer((req, res) => { void handler(req, res) }).listen(3000)
```

Because it is a `(req, res)` handler, it also mounts on Express or Connect.

### Fetch / Web (Hono, Vike, edge runtimes)

For any runtime that speaks the Web Standard `Request` / `Response`, use `createWebRequestHandler` from the `@gemstack/mcp/runtime` subpath; it returns `(request: Request) => Promise<Response>`:

```ts
import { Hono } from 'hono'
import { createWebRequestHandler } from '@gemstack/mcp/runtime'

const handler = createWebRequestHandler(new DemoServer())
const app = new Hono()
app.all('/mcp', (c) => handler(c.req.raw))
```

By default each new client gets its own transport (stateful sessions). Pass `sessionIdGenerator: undefined` for **stateless** mode, where a single transport is created lazily and reused for the handler's lifetime. `createMcpHttpHandler` is built on top of this Web handler.

### stdio

For a CLI / local server (e.g. spawned by Claude Desktop), use `startStdio` from `@gemstack/mcp/runtime`:

```ts
import { startStdio } from '@gemstack/mcp/runtime'

await startStdio(new DemoServer())
```

> **Runnable example.** [`examples/mcp-quickstart`](https://github.com/gemstack-land/gemstack/tree/main/examples/mcp-quickstart) is a complete, framework-neutral server (tool, resource, prompt, `@Handle` DI, OAuth 2.1) served over both `node:http` and Hono, with a CI smoke test and zero framework dependencies.

## OAuth 2.1

Protect a web endpoint with bearer tokens. The core is auth-agnostic: you supply a `verifyToken` that validates the JWT (signature, expiry, revocation) and returns its claims, or `null`/throws when invalid. Back it with any JWT library (`jose` shown here), a token-introspection endpoint, or a framework's auth integration.

Two pieces work together, and you need **both**:

1. `oauth2McpMiddleware('/mcp', options)` guards the MCP endpoint and, on failure, returns an RFC 9728 `WWW-Authenticate` challenge.
2. `registerOAuth2Metadata(router, '/mcp', options)` serves the protected-resource metadata document at `/.well-known/oauth-protected-resource/mcp` that the challenge points clients to. Without it, compliant clients can't discover the authorization server.

```ts
import { oauth2McpMiddleware, registerOAuth2Metadata } from '@gemstack/mcp'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(new URL('https://issuer.example.com/.well-known/jwks.json'))

const options = {
  scopes: ['mcp.read'],
  scopesSupported: ['mcp.read', 'mcp.write'],
  authorizationServers: ['https://issuer.example.com'],
  verifyToken: async (jwt: string) => {
    try {
      const { payload } = await jwtVerify(jwt, JWKS, { audience: 'https://api.example.com/mcp' })
      // map your token's claims onto { sub?, scopes? }
      return { sub: payload.sub, scopes: String(payload['scope'] ?? '').split(' ').filter(Boolean) }
    } catch {
      return null   // invalid/expired -> 401
    }
  },
}

// Express/Connect-style wiring:
app.use('/mcp', oauth2McpMiddleware('/mcp', options))
registerOAuth2Metadata(app, '/mcp', options)
```

On success the verified claims are attached to the request as `req.mcpAuth` (`{ sub?, scopes?, claims }`). A missing or invalid token yields `401 invalid_token`; a valid token missing a required scope yields `403 insufficient_scope`. Match your IdP's token config to the `scopes` you require.

## Testing

`McpTestClient` exercises a server's tools, resources, and prompts in-process, with no transport, so assertions run the same dispatch path the HTTP transport uses:

```ts
import { McpTestClient } from '@gemstack/mcp/testing'

const client = new McpTestClient(DemoServer)
const result = await client.callTool('echo', { message: 'hi' })
// result.content[0].text === 'hi'

// With DI:
const client2 = new McpTestClient(LogServer, { resolver })
```

Beyond `callTool`, the client offers `listTools` / `listResources` / `listPrompts`, `readResource(uri)`, `getPrompt(name, args)`, and assertion helpers (`assertToolExists`, `assertToolCount`, and the resource / prompt equivalents). `callTool` accepts an `onProgress` callback to capture a streaming tool's yields.

## Observers

Subscribe to structured tool / resource / prompt events (for tracing or telemetry) via `@gemstack/mcp/observers`. The registry (`mcpObservers`) is a `globalThis` singleton, so state survives module re-evaluation, and each emit is wrapped in a try/catch so an observer error never breaks an MCP server:

```ts
import { mcpObservers } from '@gemstack/mcp/observers'

const unsubscribe = mcpObservers.subscribe((event) => {
  // event: { kind, serverName, name, input, output, duration, error? }
  console.log(event.kind, event.name, event.duration)
})
```

## Authoring utilities

For custom inspectors or tooling built on the core, the main entry also exports two pure helpers: `zodToJsonSchema(schema)` converts a Zod object to the JSON Schema MCP advertises, and `matchUriTemplate(template, uri)` matches a URI against a `resource://{template}` pattern.

## License

MIT
