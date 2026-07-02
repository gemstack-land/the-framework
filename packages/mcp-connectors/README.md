# @gemstack/mcp-connectors

The connector contract for GemStack AI orchestration. Define a tool connector to an external service (GitHub, Google Drive, ...) once with `defineConnector`, then compose any number of connectors into a single MCP server with `mountConnectors`.

Built on [`@gemstack/mcp`](../mcp). Framework-agnostic: the server it produces plugs into the same surface as any other `@gemstack/mcp` server (`Mcp.web` / `Mcp.local`, `McpTestClient`, the neutral HTTP handler).

> A connector only **declares** what it needs (its auth requirement) and **what it does** (its tools). It never reaches for env vars, OAuth, or a transport itself. The orchestrator that mounts it supplies credentials and chooses how to serve it. That split is what lets first-party and third-party connectors compose interchangeably.

## Install

```bash
npm i @gemstack/mcp-connectors @gemstack/mcp zod
```

## Define a connector

```ts
import { defineConnector } from '@gemstack/mcp-connectors'
import { z } from 'zod'

export default defineConnector({
  id: 'notes', // lowercase, used to namespace this connector's tools
  name: 'Notes',
  auth: { type: 'none' }, // 'none' | 'pat' | 'oauth'
  tools: [
    {
      name: 'list',
      description: 'List all notes',
      schema: z.object({}),
      annotations: { readOnly: true },
      handle: () => ['buy milk', 'ship connectors'],
    },
    {
      name: 'get',
      description: 'Get one note by index',
      schema: z.object({ index: z.number() }),
      annotations: { readOnly: true },
      handle: (input, ctx) => {
        // ctx.auth carries the credential the orchestrator resolved for 'notes'
        return getNote(input.index)
      },
    },
  ],
})
```

A tool's `handle` may return a `string` (wrapped as text), any JSON-serializable value (wrapped as pretty JSON), or a full `McpToolResult`. For an expected, user-facing failure (validation, not-found), return `McpResponse.error(...)` (re-exported from this package) so the client sees a failed tool call (`isError: true`) it can detect, rather than a success result that merely contains an `error` field. Reserve throwing for unexpected faults.

## Mount connectors into a server

```ts
import { mountConnectors } from '@gemstack/mcp-connectors'
import { Mcp } from '@gemstack/mcp'
import notes from './notes.js'
import github from '@gemstack/mcp-connector-github'

const Server = mountConnectors([notes, github], {
  name: 'my-orchestrator',
  // Resolve each connector's credential at call time. This is the seam that
  // satisfies a connector's declared `auth`.
  credentials: (id) => ({ token: process.env[`${id.toUpperCase()}_TOKEN`] }),
})

// The result is a standard @gemstack/mcp server class.
Mcp.web('/mcp/connectors', Server)
```

Tools are namespaced by connector id, so `notes.list` is exposed as `notes_list` and never collides with another connector's `list`. Pass `namespace: 'none'` to keep names verbatim (you then own collision-avoidance).

## Auth requirements

A connector declares one of:

| `auth.type` | Means | Credential the orchestrator provides |
|---|---|---|
| `none` | Public / local data | `{}` |
| `pat` | Personal access token / API key (`env` names a default var) | `{ token }` |
| `oauth` | OAuth 2.1 bearer (`scopes`, `authorizationServers`) | `{ token }` |

For `oauth`, protect the mounted endpoint with `@gemstack/mcp`'s `oauth2McpMiddleware` + `registerOAuth2Metadata` and feed the verified token through `credentials`.

## Testing

```ts
import { McpTestClient } from '@gemstack/mcp/testing'
import { mountConnectors } from '@gemstack/mcp-connectors'

const client = new McpTestClient(mountConnectors([notes]))
await client.listTools() // [{ name: 'notes_list', ... }, { name: 'notes_get', ... }]
await client.callTool('notes_get', { index: 0 })
```

## API

- `defineConnector(def): Connector` — validate + fill defaults.
- `mountConnectors(connectors, options?): ConnectorServerClass` — compose into one `@gemstack/mcp` server class.

See `examples/connectors-quickstart` in the repo for a runnable reference connector to copy from.
