# @gemstack/ai-mcp

The bridge between [`@gemstack/ai-sdk`](/packages/ai-sdk/) Agents and [Model Context Protocol](https://modelcontextprotocol.io) servers. Two connectors:

- **`mcpClientTools(transport, opts?)`** - consume a remote MCP server's tools as Agent tools.
- **`mcpServerFromAgent(AgentClass, opts?)`** - expose an Agent as an MCP server that external clients (Claude Desktop, Cursor, etc.) can call.

This is the **agent bridge** axis of MCP. It depends on `@gemstack/ai-sdk` and is useless without an Agent. It was carved out of `@gemstack/ai-sdk`'s `/mcp` subpath so the optional MCP SDK dependency is declared only by the package that actually needs it.

## Which MCP package do I use?

| You want to... | Use |
|---|---|
| Expose an existing Agent, or feed remote MCP tools into one | **`@gemstack/ai-mcp`** (this package) |
| Author an MCP server from scratch (tools / resources / prompts / auth), agent-agnostic | [`@gemstack/mcp`](/packages/mcp) |

Both can "produce an MCP server", but from different inputs: `mcpServerFromAgent(anAgent)` versus a hand-authored server. That overlap is expected, not duplication.

## Installation

```bash
pnpm add @gemstack/ai-mcp @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is an **optional peer dependency**: install it when you use this bridge. `@gemstack/ai-sdk` comes in as a regular dependency.

## Consume a remote MCP server's tools

`mcpClientTools` connects to a remote MCP server and returns its tools as `@gemstack/ai-sdk` tools. It accepts three transport shapes:

```ts
import { mcpClientTools } from '@gemstack/ai-mcp'

// (a) HTTP - string URL or URL instance (Streamable HTTP transport)
const tools = await mcpClientTools('https://api.example.com/mcp')

// (b) Local stdio subprocess
const tools = await mcpClientTools({ command: 'npx', args: ['some-mcp-server'] })

// (c) Already-connected SDK Client (caller owns lifecycle)
const tools = await mcpClientTools(myClient)
```

Spread the result into your Agent's `tools()`:

```ts
class MyAgent extends Agent {
  tools() { return [...tools, ...myOwnTools] }   // close() is non-enumerable, so it's not iterated
}
// ... later
await tools.close?.()
```

### The `close()` lifecycle

When this call owns the connection (cases **a** and **b**) the returned array carries a non-enumerable `close()` method; call it when the agent is done so the subprocess or HTTP session shuts down cleanly. When you pass your own `Client` (case **c**) there is no `close()`: you own that lifecycle.

### Options

`mcpClientTools(transport, opts)` accepts:

| Option | Default | Effect |
|---|---|---|
| `filter` | all tools | `(toolName) => boolean` - drop remote tools you don't want to expose. |
| `namePrefix` | `''` | Prefix every tool name, to avoid collisions when wiring several remote servers. |
| `streaming` | `true` | Forward the remote server's `notifications/progress` as `tool-update` chunks during a run. |

```ts
const tools = await mcpClientTools('https://api.example.com/mcp', {
  filter: (name) => !name.startsWith('internal_'),
  namePrefix: 'remote_',
})
```

The stdio transport spawn config (`StdioServerSpawn`) takes `command`, optional `args`, `env` (inherited from the parent when omitted), and `cwd`.

## Expose an Agent as an MCP server

`mcpServerFromAgent(AgentClass, opts?)` builds an MCP server from one of your [agents](/packages/ai-sdk/agents). Connect it to any MCP transport:

```ts
import { mcpServerFromAgent } from '@gemstack/ai-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = await mcpServerFromAgent(MyAgent)
await server.connect(new StdioServerTransport())
```

### Exposure modes

Via `opts.expose`:

| Mode | What it exposes | Best for |
|---|---|---|
| `'tools'` (default) | One MCP tool per `agent.tools()` entry. | Surfacing an agent's toolbox to other MCP clients. |
| `'agent'` | A single MCP tool that runs the whole agent (`prompt(text) -> text`). | Shipping one agent that any MCP client can call. |
| `'both'` | The individual tools and the agent prompt-tool, side by side. | Both at once. |

Other options: `name` / `version` (server identity; `name` defaults to `${AgentClass.name}Server`), `instructions` (advertised server instructions, defaulting to the agent's `instructions()`), and `agentToolName` (the prompt-tool's name in `'agent'` / `'both'` mode, defaulting to the agent class name).

## See also

- [mcp](/packages/mcp) - author a standalone MCP server (the other MCP axis).
- [Agents](/packages/ai-sdk/agents) - the agents this package bridges to MCP.
