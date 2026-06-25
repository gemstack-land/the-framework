# GemStack Architecture

A shared reference for how GemStack packages are layered and named. This is the working document for design discussion; it will firm up as packages land.

## The naming rule

The `ai-` prefix means **"depends on the agent runtime."** A package about AI that is agent-agnostic does not get the `ai-` prefix; it is a peer of the AI family, not a member.

## The AI family

```
@gemstack/ai-sdk        agent runtime (the "verbs")
@gemstack/ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
@gemstack/ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
@gemstack/ai-mcp        agent <-> MCP bridge (the "adapter")           -> ai-sdk
-----------------------------------------------------------------------------------
@gemstack/mcp (later)   standalone MCP server framework               agent-agnostic, NOT ai-*
```

### Dependency direction (the one rule that keeps four packages from becoming a tangle)

`skills`, `autopilot`, and `ai-mcp` all depend on `ai-sdk`. `ai-sdk` depends on none of them. Nothing depends "up." If the arrows are not one-directional, the split is wrong.

### What stays in the core vs what carves out

- **Stays in `ai-sdk`:** what is intrinsic to running an agent. Providers, the agent loop, tools, streaming, middleware, structured output, basic memory.
- **Carves out:** what has a heavy/optional dependency or a genuinely different consumer. `ai-mcp` is the first carve-out (it has its own SDK dependency and a distinct audience). `eval` is a good later candidate (dev/test-time, different lifecycle). Resist fragmenting into many micro-packages; each carve-out is a peer-dep seam maintained forever.

### Definitions

- **skill** = a portable, loadable capability bundle (instructions + tools + resources), composed onto an agent on demand. Distinct from a single `tool`. (See the `boost/skills/` `SKILL.md` bundles in `ai-sdk` for the shape.) `ai-skills` is the registry + loader + runtime for those bundles.
- **autopilot** = autonomy and orchestration: multi-agent, planning loops, long-running runs, handoffs.

## MCP taxonomy (two axes, do not conflate)

MCP shows up in GemStack in two fundamentally different roles. They point in opposite directions and must not be merged into one package.

| | Agent bridge | Server framework |
|---|---|---|
| **Package** | `@gemstack/ai-mcp` | `@gemstack/mcp` (agent-agnostic; not `ai-*`) |
| **Rudder origin** | `@rudderjs/ai/mcp` (a subpath today) | `@rudderjs/mcp` (a standalone package, mature) |
| **What it is** | A thin bridge that makes an **Agent** speak MCP | A full framework for **authoring MCP servers** |
| **Surface** | `mcpClientTools` (consume a remote MCP server's tools as Agent tools) + `mcpServerFromAgent` (wrap an Agent as an MCP server) | `McpServer`, `McpTool`, `McpResource`, `McpPrompt`, decorators (`@Name`/`@Version`/`@Instructions`), OAuth2 middleware, a provider, a test client, a `make-mcp-server` scaffolder |
| **Centered on** | the Agent abstraction | your application (a server can expose anything: DB, files, weather; no agent involved) |
| **Coupling** | depends on `ai-sdk`; useless without an Agent | agent-agnostic; does not depend on `ai-sdk` |
| **Use it when** | you are exposing an existing Agent, or feeding remote MCP tools into one | you are authoring a server from scratch (tools / resources / prompts / auth) |

**Why the AI layer has an inner mcp at all:** the bridge only makes sense with the Agent type, and it is optional (gated behind an optional `@modelcontextprotocol/sdk` peer dependency). So it lives next to the thing it extends, and consumers who never touch it never install the SDK. Forcing every AI user to pull in the whole server framework for two helper functions would be wrong.

**The "which MCP do I use?" decision (document this so the two never look like duplicates):**

> Exposing an existing Agent? Use `ai-mcp`. Authoring a server from scratch (tools / resources / prompts / auth)? Use `mcp`.

There is a tiny surface overlap (both can "produce an MCP server"), but from different inputs: `mcpServerFromAgent(anAgent)` versus a hand-authored `McpServer`. That is expected, not duplication.

## Open question on `ai-mcp`

The bridge is two functions today. It can be promoted to its own package `@gemstack/ai-mcp` (symmetry with the family, justifies its own optional-dep boundary, makes a clean first carve-out), or kept as a subpath `@gemstack/ai-sdk/mcp` until it grows. Current lean: promote to a package, as the first carve-out that proves the dependency seam works.

## Suggested ship order

1. `@gemstack/ai-sdk` (now)
2. `@gemstack/ai-mcp` (first carve-out; cheap, and forces the dependency seam to be proven early)
3. `@gemstack/ai-skills`
4. `@gemstack/ai-autopilot`
