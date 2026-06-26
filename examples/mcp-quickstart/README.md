# @gemstack/mcp quickstart

A runnable, framework-neutral MCP server built with `@gemstack/mcp` and **zero `@rudderjs/*` packages**. It proves the "agent-agnostic, standalone" claim: one tool, one resource, one prompt, dependency injection without a container, and OAuth 2.1 protection, served over both raw `node:http` and Hono.

## What's here

| File | Shows |
|---|---|
| `src/server.ts` | Define a tool / resource / prompt; inject a service with `@Handle` + `createResolver` (no DI container); supply a `verifyToken` for OAuth. |
| `src/node-http.ts` | Serve it over raw `node:http`, protected by OAuth 2.1, via a ~10-line `res` adapter. |
| `src/hono.ts` | Serve the same server on Hono via the Fetch-style `createWebRequestHandler`. |
| `src/quickstart.test.ts` | A CI smoke: authenticated round-trip, a `401` for missing token, and the Hono mount. |

## Run it

From this directory (after `pnpm install` at the repo root):

```bash
# raw node:http, OAuth-protected, on :3000
pnpm start:node

# the same server on Hono
pnpm start:hono
```

Then drive it with any MCP client pointed at `http://localhost:3000/mcp`. For the `node:http` server, send `Authorization: Bearer demo-token` (see `DEMO_TOKEN` in `src/server.ts`).

## Verify (CI)

```bash
pnpm test
```

This boots the servers on ephemeral ports and runs a real MCP session against each (the SDK `Client` over `StreamableHTTPClientTransport`), asserting the authenticated call succeeds, an unauthenticated call is rejected with `401`, and the Hono mount serves the same tools.

## Dependency injection

`makeServer()` passes an **instance-scoped** resolver to the server. `createResolver()` needs no container. To back it with a real container, implement the one-method `McpResolver` over it:

```ts
import { createContainer, asValue } from 'awilix'
import type { McpResolver } from '@gemstack/mcp'

const container = createContainer().register({ greeter: asValue(new Greeter()) })
const resolver: McpResolver = { resolve: (token) => container.resolve((token as { name: string }).name) }
new QuickstartServer({ resolver })
```

## OAuth on the Fetch path

`oauth2McpMiddleware` is Connect-shaped, so `src/node-http.ts` uses it directly. To protect the Hono/Fetch mount, read the `Authorization` header in a Hono middleware and call the same `verifyToken` before delegating to the handler.
