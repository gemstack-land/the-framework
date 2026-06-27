# What is GemStack?

GemStack is a collection of high-quality, framework-agnostic tools for building AI applications in Node. Each tool is a standalone, well-tested package that works in any Node app and composes cleanly with the others.

It is shared, community-governed infrastructure built in the open with the [Vike](https://vike.dev) team. Packages join GemStack by *graduating* one at a time - when they prove framework-agnostic value - not by bulk-moving a framework's package set in.

## The family

All packages publish under the **`@gemstack/`** scope.

| Package | What it is |
|---|---|
| [`ai-sdk`](/packages/ai-sdk/) | The agent runtime: providers, the agent loop, tools, streaming, middleware, structured output, memory, and evals. The engine the rest of the family builds on. |
| [`ai-skills`](/packages/ai-skills) | Portable capability bundles: load `SKILL.md` skills (instructions + tools + resources) and compose them onto an agent on demand. |
| [`ai-autopilot`](/packages/ai-autopilot) | Orchestration: a Supervisor that plans, dispatches subagents (bounded concurrency + budget guardrails), and synthesizes the result. |
| [`ai-mcp`](/packages/ai-mcp) | The agent/MCP bridge: consume a remote MCP server's tools as agent tools, and expose an agent as an MCP server. |
| [`mcp`](/packages/mcp) | A standalone framework for *authoring* MCP servers: tools, resources, prompts, decorators, OAuth 2.1, a framework-neutral HTTP handler, and a test client. Agent-agnostic. |

## How they fit together

```
ai-sdk        agent runtime (the "verbs")
ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
ai-mcp        agent <-> MCP bridge (the "adapter")           -> ai-sdk
-----------------------------------------------------------------------------------
mcp           standalone MCP server framework                agent-agnostic, not ai-*
```

`ai-sdk` is the foundation: it owns the single-agent loop, tools, and streaming. `ai-skills` and `ai-autopilot` build on top of it. `ai-mcp` bridges an agent to the Model Context Protocol. `mcp` stands apart - it is for *authoring* MCP servers and knows nothing about agents.

## Design principles

- **Framework-agnostic core.** Every package runs in any `fetch`-capable JS runtime - Node, the browser, Electron, React Native. The agent runtime has zero static `node:*` imports in its main entry, and its only required runtime dependency is `zod`.
- **Neutral contracts, not bundled infrastructure.** Persistence (conversation history, user memory, budgets, suspended runs, generated-file storage) is defined as interfaces you implement against your own database, cache, or object store. In-memory defaults ship for getting started.
- **One way to do a thing.** A single `toolDefinition()` shape, a single `Agent` base, a single provider config object - shared across the whole family.
- **Graduated, not dumped.** GemStack grows by promoting packages that earn framework-agnostic standing, with the API settling toward `1.0` in the open.

## Where these came from

The AI engine was spun out of Rudder's `@rudderjs/ai` and re-versioned under the GemStack umbrella. The Rudder package now re-exports this engine and adds the Rudder-specific bindings on top (an ORM-backed store set, a `/server` provider, a `make:agent` scaffolder). Those bindings are documented in Rudder's own docs; everything here is the framework-agnostic engine.

## Next

- [Installation](/guide/installation) - install the runtime and a provider SDK.
- [Your First Agent](/guide/first-agent) - define and run an agent in a few lines.
