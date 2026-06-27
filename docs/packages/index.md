# The GemStack family

All packages publish under the **`@gemstack/`** scope (e.g. `npm install @gemstack/ai-sdk`). Each is standalone and framework-agnostic; they compose, but you adopt only what you need.

| Package | Description |
|---|---|
| [`ai-sdk`](/packages/ai-sdk/) | The agent runtime: providers, the agent loop, tools, streaming, middleware, structured output, memory, and evals. The engine the rest of the AI family builds on. |
| [`ai-skills`](/packages/ai-skills) | Portable capability bundles: load `SKILL.md` skills (instructions + tools + resources) and compose them onto an agent on demand. |
| [`ai-autopilot`](/packages/ai-autopilot) | Orchestration: a Supervisor that plans, dispatches subagents (bounded concurrency + budget guardrails), and synthesizes the result. |
| [`ai-mcp`](/packages/ai-mcp) | The agent/MCP bridge: consume a remote MCP server's tools as agent tools, and expose an agent as an MCP server. |
| [`mcp`](/packages/mcp) | A standalone framework for *authoring* MCP servers: tools, resources, prompts, decorators, OAuth 2.1, a framework-neutral HTTP handler, and a test client. Agent-agnostic. |
| [`orm`](/packages/orm) | The data engine: a narrow, ORM-free repository (`db.users.upsert(...)`) over a composed schema, plus the adapter contract and a one-adapter registry. The data-layer twin of `ai-sdk`. |
| [`schema`](/packages/schema) | The shape engine: declare tables once as plain data, merge contributions, derive migrations, compile to Prisma / Drizzle / Rudder. **Preview.** |
| [`orm-memory`](/packages/orm#adapters) | In-process `Map` adapter for `orm` — tests, demos, zero-config dev. |
| [`orm-drizzle`](/packages/orm#adapters) | Drizzle adapter for `orm` — real databases. |

## How they fit together

```
ai-sdk        agent runtime (the "verbs")
ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
ai-mcp        agent <-> MCP bridge (the "adapter")           -> ai-sdk
-----------------------------------------------------------------------------------
mcp           standalone MCP server framework                agent-agnostic, not ai-*
-----------------------------------------------------------------------------------
schema        data shape: define tables, merge, derive migrations   (preview)
orm           runtime data access over a composed schema
orm-memory    in-process Map adapter (tests/demos)           -> orm
orm-drizzle   Drizzle adapter (real databases)               -> orm
```

### Two engine families

GemStack has two independent engine families plus the standalone MCP framework:

- The **AI family** (`ai-sdk` + `ai-skills` / `ai-autopilot` / `ai-mcp`) — everything for running agents.
- The **data family** (`orm` + `schema` + adapters) — framework-agnostic data access: `orm` reads and writes without importing an ORM, `schema` declares tables once and compiles to any ORM. Parallel to the AI family, and independent of it — adopt either on its own.

### Two MCP packages, two jobs

`ai-mcp` and `mcp` both touch the Model Context Protocol, but from opposite ends:

- **`ai-mcp`** is the *agent bridge*. It depends on `ai-sdk` and is useless without an agent: feed a remote MCP server's tools into an agent, or expose an agent as an MCP server.
- **`mcp`** is for *authoring* MCP servers from scratch - tools, resources, prompts, OAuth - and knows nothing about agents.

Both can "produce an MCP server", but from different inputs (`mcpServerFromAgent(anAgent)` versus a hand-authored server). That overlap is expected, not duplication.

## Versioning

Each package versions independently via Changesets. The API is settling toward `1.0` in the open; the AI family currently tracks the `0.x` line while contracts stabilize. See the [releases](https://github.com/gemstack-land/gemstack/releases) for changelogs.
