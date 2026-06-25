# GemStack Architecture

A shared reference for how GemStack packages are layered and named. This is the working document for design discussion; it will firm up as packages land.

## The naming rule

The `ai-` prefix means **"depends on the agent runtime."** A package about AI that is agent-agnostic does not get the `ai-` prefix; it is a peer of the AI family, not a member.

## What belongs in GemStack: engines, not bindings

GemStack hosts **framework-agnostic engines** that work in any Node app. It does not host framework-specific bindings or extensions. This is the line that keeps the umbrella legible.

- **Engines (belong here):** `@gemstack/ai-sdk` and its family. They have no hard dependency on any framework.
- **Bindings (do not belong here):** framework extensions like the `vike-*` packages (in the `vike-data` repo). Their whole value is the framework integration, so they are the opposite of agnostic. They live with their framework and **consume** GemStack engines, e.g. `vike-ai` is a thin Vike binding over `@gemstack/ai-sdk`:

```
@gemstack/ai-sdk      (agnostic engine, here)
       ^
       | thin binding
vike-ai               (Vike extension, in vike-data) -- consumes the engine
```

### Graduation, not bulk relocation

Packages join GemStack by **graduating**, one at a time, when they prove framework-agnostic value, not by bulk-moving a framework's package set in.

- `@gemstack/ai-sdk` is the template: it matured inside Rudder as `@rudderjs/ai`, proved it was agnostic and broadly useful, then graduated to `@gemstack/`.
- A `vike-*` package moves here only if a genuinely agnostic *core* falls out of it that is useful beyond its framework. In that case the core graduates (e.g. `@gemstack/<core>`) while the framework binding stays `vike-*`.
- Because both repos are co-governed and the `vike-*` set sits in the Vike orbit, any such move is decided with the Vike team, when there is brand traction, not unilaterally.

### Graduation candidates already in `vike-data`

An audit of `vike-data` shows the agnostic engines are not in the `vike-*` packages (those are bindings) but in the `universal-*` packages, which already carry **zero Vike imports**. These are the real candidates, in priority order after `@gemstack/ai-sdk`:

| Candidate (today) | Would become | Notes |
|---|---|---|
| `@universal-orm/core` (+ `@universal-orm/drizzle` / `/memory` / `/rudder`) | `@gemstack/orm` (+ adapters) | The ORM analog of `@gemstack/ai-sdk`. Mature, clearly agnostic. The strongest next candidate; move the core + its adapter family together. |
| `@vike-data/universal-schema` | `@gemstack/schema` | "Usable standalone by any framework or ORM." Agnostic, but currently mis-scoped under `@vike-data`. |
| `@vike-data/kit` | (stays) | Agnostic primitives (`createPort`), but it is the kit for *authoring bindings*, so it belongs with the binding ecosystem, not the engine umbrella, unless GemStack later wants a shared-primitives package. |

Realized fully, GemStack is the unified home for agnostic engines: `@gemstack/ai-sdk` (AI), `@gemstack/orm` (data), `@gemstack/schema` (schema).

### The open brand-consolidation question (for the Vike team)

These are not orphaned code needing a home: `@universal-orm` is already its own deliberate npm scope, and `universal-schema` sits under `@vike-data`. So there are **three agnostic-ish scopes in play** (`@gemstack`, `@universal-orm`, `@vike-data`). The decision is therefore not "where should this code live" but **"do we consolidate the agnostic engines under one umbrella (`@gemstack`), or keep `@universal-orm` as a parallel brand?"** Since `@universal-orm` is co-developed, this is a decide-with-the-Vike-team call, gated on brand traction.

When a candidate does graduate, follow the `@gemstack/ai-sdk` playbook exactly: copy the source in, rename to the `@gemstack/*` name, leave a deprecated re-export shim at the old name, reset to a fresh `0.x` line, then repoint dependents.

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
