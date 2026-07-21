# @gemstack/mcp-connectors

The **connector contract** for GemStack AI orchestration. Define a tool connector to an external service (GitHub, Google Drive, ...) once with `defineConnector`, then compose any number of connectors into a single [`@gemstack/mcp`](/packages/mcp) server with `mountConnectors`.

A connector only **declares** what it needs (its auth requirement) and **what it does** (its tools). It never reaches for env vars, OAuth, or a transport itself. The orchestrator that mounts it supplies credentials and chooses how to serve it. That split is what lets first-party and third-party connectors compose interchangeably.

> Already looking for a specific service? See the [connector registry](/packages/mcp-connectors-registry) for the published connectors (GitHub, Google Drive) and the `mcp-connector-*` naming convention.

## Installation

```bash
npm i @gemstack/mcp-connectors @gemstack/mcp zod
```

The server it produces plugs into the same surface as any other `@gemstack/mcp` server (`createMcpHttpHandler`, `createWebRequestHandler`, `startStdio`, `McpTestClient`).

## Writing a connector

A connector is one object passed to `defineConnector`: an `id` (used to namespace its tools), an `auth` requirement, and a list of `tools`. Here is the reference connector shipped in `examples/connectors-quickstart` — a read-only `library` over an in-memory list. Copy it to start a real one: swap the in-memory data for calls to your API, and change `auth` from `none` to `pat` / `oauth`.

```ts
import { defineConnector } from '@gemstack/mcp-connectors'
import { z } from 'zod'

const BOOKS = [
  { id: 'b1', title: 'The Pragmatic Programmer', author: 'Hunt & Thomas' },
  { id: 'b2', title: 'Refactoring', author: 'Fowler' },
]

export default defineConnector({
  id: 'library', // lowercase letters, digits, '-'; namespaces this connector's tools
  name: 'Reference Library',
  instructions: 'A read-only demo connector over a small in-memory book list.',
  auth: { type: 'none' }, // 'none' | 'pat' | 'oauth'
  tools: [
    {
      name: 'list-books',
      description: 'List every book in the library.',
      schema: z.object({}),
      annotations: { readOnly: true },
      handle: () => BOOKS,
    },
    {
      name: 'get-book',
      description: 'Fetch one book by id.',
      schema: z.object({ id: z.string() }),
      annotations: { readOnly: true },
      handle: (input: { id: string }, ctx) => {
        // ctx.auth carries the credential the orchestrator resolved for 'library'.
        return BOOKS.find((b) => b.id === input.id) ?? { error: `no book ${input.id}` }
      },
    },
  ],
})
```

### A tool

Each entry in `tools` is one tool the connector exposes:

| Field | Required | Purpose |
|---|---|---|
| `name` | yes | Unique within the connector. Kept verbatim, namespaced at mount (`library` + `get-book` -> `library_get-book`). |
| `description` | recommended | One line shown to the agent. |
| `schema` | yes | A Zod object (v3 or v4). The runtime source of truth for input validation. |
| `annotations` | no | Behavioural hints: `readOnly`, `destructive`, `idempotent`, `openWorld`. Let agents reason before calling (e.g. auto-approve `readOnly`). |
| `handle` | yes | `(input, ctx) => result`. Receives validated `input` and the connector [context](#the-handler-context). |

A `handle` may return a `string` (wrapped as text), any JSON-serializable value (wrapped as pretty JSON), or a full `McpToolResult` (use `McpResponse` from `@gemstack/mcp` for errors / images).

### The handler context

The second `handle` argument is the `ConnectorContext`:

- `ctx.connectorId` — the id of the connector this tool belongs to.
- `ctx.auth` — the `Credential` the orchestrator resolved for this connector (`{}` when none was provided). `ctx.auth.token` is the common case (a PAT or OAuth bearer).

A connector never reads `process.env` or runs an OAuth handshake itself — it reads `ctx.auth.token` and lets the orchestrator decide where that came from. See the [GitHub](/packages/mcp-connector-github) and [Google Drive](/packages/mcp-connector-google-drive) connectors for the same pattern over a real REST client.

## Auth requirements

A connector declares one of:

| `auth.type` | Means | Credential the orchestrator provides |
|---|---|---|
| `none` | Public / local data | `{}` |
| `pat` | Personal access token / API key (`env` names a default var) | `{ token }` |
| `oauth` | OAuth 2.1 bearer (`scopes`, `authorizationServers`) | `{ token }` |

For `oauth`, protect the mounted endpoint with `@gemstack/mcp`'s `oauth2McpMiddleware` + `registerOAuth2Metadata` and feed the verified token through `credentials` (below).

## Mount connectors into a server

`mountConnectors` composes any number of connectors into one standard `@gemstack/mcp` server class.

```ts
import { createServer } from 'node:http'
import { mountConnectors } from '@gemstack/mcp-connectors'
import { createMcpHttpHandler } from '@gemstack/mcp'
import library from './library-connector.js'
import github from '@gemstack/mcp-connector-github'

const Server = mountConnectors([library, github], {
  name: 'my-orchestrator',
  // Resolve each connector's credential at call time. This is the seam that
  // satisfies a connector's declared `auth`.
  credentials: (id) => ({ token: process.env[`${id.toUpperCase()}_TOKEN`] }),
})

// `Server` is a standard @gemstack/mcp server class. Instantiate it and hand
// the instance to a transport handler.
const handler = createMcpHttpHandler(new Server())
createServer((req, res) => { void handler(req, res) }).listen(3000)
```

`createMcpHttpHandler` is the raw `node:http` / Express / Connect mount. For a Fetch-style host (Hono, Vike, Bun, Deno, Workers) use `createWebRequestHandler(new Server())` from `@gemstack/mcp/runtime`, which returns a `(Request) => Promise<Response>`. For a local CLI over stdio, `await startStdio(new Server())` from the same subpath.

Tools are namespaced by connector id, so `library.get-book` is exposed as `library_get-book` and never collides with another connector's `get-book`. Pass `namespace: 'none'` to keep names verbatim (you then own collision-avoidance).

## Testing

A mounted connector is a normal `@gemstack/mcp` server, so drive it with `McpTestClient` — no transport, no network:

```ts
import { McpTestClient } from '@gemstack/mcp/testing'
import { mountConnectors } from '@gemstack/mcp-connectors'
import library from './library-connector.js'

const client = new McpTestClient(mountConnectors([library]))

await client.listTools() // [{ name: 'library_list-books', ... }, ...]
await client.callTool('library_get-book', { id: 'b1' })
```

To test a connector that calls a real API, stub global `fetch` and assert on the requests it makes — that is exactly how the [GitHub](https://github.com/gemstack-land/gemstack/blob/main/packages/mcp-connector-github/src/index.test.ts) and [Google Drive](https://github.com/gemstack-land/gemstack/blob/main/packages/mcp-connector-google-drive/src/index.test.ts) connectors are tested.

## API

- `defineConnector(def): Connector` — validate the definition + fill defaults.
- `mountConnectors(connectors, options?): ConnectorServerClass` — compose into one `@gemstack/mcp` server class. Options: `name`, `version`, `instructions`, `namespace` (`'id'` default | `'none'`), and `credentials(id) => Credential`.

## See also

- [The connector registry](/packages/mcp-connectors-registry) — published connectors + the `mcp-connector-*` convention for shipping your own.
- [`mcp`](/packages/mcp) — the server framework a mounted connector becomes.
- [`ai-mcp`](/packages/ai-mcp) — feed a mounted connector's tools into an agent.
