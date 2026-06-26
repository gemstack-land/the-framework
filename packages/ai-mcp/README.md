# @gemstack/ai-mcp

The bridge between [`@gemstack/ai-sdk`](https://github.com/gemstack-land/gemstack/tree/main/packages/ai-sdk) Agents and [Model Context Protocol](https://modelcontextprotocol.io) servers. Two connectors:

- **`mcpClientTools(transport, opts?)`** — consume a remote MCP server's tools as Agent tools.
- **`mcpServerFromAgent(AgentClass, opts?)`** — expose an Agent as an MCP server that external clients (Claude Desktop, Cursor, etc.) can call.

This is the **agent bridge** axis of MCP. It depends on `@gemstack/ai-sdk` and is useless without an Agent. It was carved out of `@gemstack/ai-sdk`'s `/mcp` subpath so the optional MCP SDK dependency is declared only by the package that actually needs it.

## Which MCP package do I use?

> **Exposing an existing Agent, or feeding remote MCP tools into one?** Use `@gemstack/ai-mcp` (this package).
> **Authoring an MCP server from scratch** (tools / resources / prompts / auth)? Use a standalone MCP server framework — that is a separate, agent-agnostic concern, not this bridge.

Both can "produce an MCP server", but from different inputs: `mcpServerFromAgent(anAgent)` versus a hand-authored server. That overlap is expected, not duplication.

## Installation

```bash
pnpm add @gemstack/ai-mcp @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is an **optional peer dependency** — install it when you use this bridge. `@gemstack/ai-sdk` comes in as a regular dependency.

## Usage

### Consume a remote MCP server's tools

```ts
import { mcpClientTools } from '@gemstack/ai-mcp'

// (a) HTTP — string URL or URL instance
const tools = await mcpClientTools('https://api.example.com/mcp')

// (b) Local stdio subprocess
const tools = await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })

// (c) Already-connected SDK Client (caller owns lifecycle)
const tools = await mcpClientTools(myClient)
```

Spread the result into your Agent's `tools()`. When this call owns the connection (cases a + b) the returned array carries a `close()` method; call it when the agent is done so the subprocess / HTTP session shuts down cleanly. When you pass your own `Client` (case c) there is no `close()` — you own that lifecycle.

```ts
class MyAgent extends Agent {
  tools() { return [...tools, ...myOwnTools] }   // close() is non-enumerable, so it's not iterated
}
// ... later
await tools.close?.()
```

**Options** (`mcpClientTools(transport, opts)`):

| Option | Default | Effect |
|---|---|---|
| `filter` | all tools | `(toolName) => boolean` — drop remote tools you don't want to expose. |
| `namePrefix` | `''` | Prefix every tool name, to avoid collisions when wiring several remote servers. |
| `streaming` | `true` | Forward the remote server's `notifications/progress` as `tool-update` chunks during a run. |

```ts
const tools = await mcpClientTools('https://api.example.com/mcp', {
  filter: (name) => !name.startsWith('internal_'),
  namePrefix: 'remote_',
})
```

### Expose an Agent as an MCP server

```ts
import { mcpServerFromAgent } from '@gemstack/ai-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = await mcpServerFromAgent(MyAgent)
await server.connect(new StdioServerTransport())
```

**Exposure modes** via `opts.expose`:

- `'tools'` (default) — one MCP tool per `agent.tools()` entry. Best for surfacing an agent's toolbox to other MCP clients.
- `'agent'` — a single MCP tool that runs the whole agent (`prompt(text) -> text`). Best for shipping one agent that any MCP client can call.
- `'both'` — the individual tools and the agent prompt-tool, side by side.

Other options: `name` / `version` (server identity), `instructions` (advertised server instructions; defaults to the agent's `instructions()`), and `agentToolName` (the prompt-tool's name in `'agent'`/`'both'` mode).

## License

MIT
