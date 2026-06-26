# GemStack

A collection of high-quality, framework-agnostic tools for building AI applications in Node.

GemStack is shared, community-governed infrastructure built with the [Vike](https://vike.dev) team. Each tool is a standalone, well-tested package that works in any Node app and composes cleanly with the others. Packages join GemStack by *graduating* one at a time, when they prove framework-agnostic value, not by bulk-moving a framework's package set in.

## Packages

| Package | Description | Version |
|---|---|---|
| [`@gemstack/ai-sdk`](./packages/ai-sdk) | The agent runtime: providers, the agent loop, tools, streaming, middleware, structured output, memory, and evals. The engine the rest of the AI family builds on. | `0.3.0` |
| [`@gemstack/ai-skills`](./packages/ai-skills) | Portable capability bundles: load `SKILL.md` skills (instructions + tools + resources) and compose them onto an agent on demand. | `0.1.0` |
| [`@gemstack/ai-autopilot`](./packages/ai-autopilot) | Orchestration: a Supervisor that plans, dispatches subagents (bounded concurrency + budget guardrails), and synthesizes the result. | `0.1.0` |
| [`@gemstack/ai-mcp`](./packages/ai-mcp) | The agent/MCP bridge: consume a remote MCP server's tools as agent tools, and expose an agent as an MCP server. | `0.1.0` |
| [`@gemstack/mcp`](./packages/mcp) | A standalone framework for *authoring* MCP servers: tools, resources, prompts, decorators, OAuth 2.1, a framework-neutral HTTP handler, and a test client. Agent-agnostic. | `0.2.0` |

### How they fit together

```
@gemstack/ai-sdk        agent runtime (the "verbs")
@gemstack/ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
@gemstack/ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
@gemstack/ai-mcp        agent <-> MCP bridge (the "adapter")          -> ai-sdk
-----------------------------------------------------------------------------------
@gemstack/mcp           standalone MCP server framework               agent-agnostic, not ai-*
```

The `ai-` prefix means **"depends on the agent runtime."** `skills`, `autopilot`, and `ai-mcp` all depend on `ai-sdk`; `ai-sdk` depends on none of them, and nothing depends "up." A package about AI that is agent-agnostic (like `@gemstack/mcp`) is a peer of the family, not a member of it.

See [`Architecture.md`](./Architecture.md) for the full layering, naming rule, and graduation policy.

### Which MCP package do I use?

The two MCP packages point in opposite directions, so they are never duplicates:

> **Exposing an existing agent?** Use [`@gemstack/ai-mcp`](./packages/ai-mcp). It makes an agent speak MCP, or feeds remote MCP tools into one.
>
> **Authoring a server from scratch** (tools / resources / prompts / auth)? Use [`@gemstack/mcp`](./packages/mcp). A full server framework, with no agent involved.

## Development

```bash
pnpm install
pnpm build        # build all packages (Turborepo)
pnpm dev          # watch mode
pnpm typecheck
pnpm test
```

This is a pnpm + Turborepo + Changesets monorepo. Runnable examples live under [`examples/`](./examples) (e.g. [`examples/mcp-quickstart`](./examples/mcp-quickstart)). See [`.changeset/README.md`](./.changeset/README.md) for the release flow.

## Origin

The AI family was spun out of Rudder's mature `@rudderjs/ai` (v1.17.x) and re-versioned under the GemStack umbrella; `@gemstack/mcp` is the graduation of `@rudderjs/mcp`. The old `@rudderjs/*` names continue as thin deprecated re-exports.

## Governance

GemStack is co-governed (shared npm `@gemstack` org + `gemstack-land` GitHub org). New tools join by mutual agreement; publish rights and 2FA are shared per the governance note.

## License

[MIT](./LICENSE)
