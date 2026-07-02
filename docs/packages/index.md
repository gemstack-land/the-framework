# The GemStack family

All packages publish under the **`@gemstack/`** scope (e.g. `npm install @gemstack/ai-sdk`). Each is standalone and framework-agnostic; they compose, but you adopt only what you need. The grid below lists the packages an app author installs directly, grouped by what they do.

<PackageGrid />

## How they fit together

```
ai-sdk        agent runtime (the "verbs")
ai-skills     capability bundles (the composable "nouns")   -> ai-sdk
ai-autopilot  orchestration / autonomy (the "director")     -> ai-sdk (+ skills)
ai-mcp        agent <-> MCP bridge (the "adapter")           -> ai-sdk
-----------------------------------------------------------------------------------
mcp           standalone MCP server framework                agent-agnostic, not ai-*
connectors    tool connectors to external services           -> mcp (composes into one)
```

### Connectors

`connectors` builds *on* `mcp`: a connector declares an external service's auth requirement and tools, and `mountConnectors` composes any number of them into a single `mcp` server. It is the open, copyable layer — third parties ship their own `connector-*` packages that mount alongside the first-party [GitHub](/packages/connector-github) and [Google Drive](/packages/connector-google-drive) connectors. See [the connector registry](/packages/connectors-registry).

### Two MCP packages, two jobs

`ai-mcp` and `mcp` both touch the Model Context Protocol, but from opposite ends:

- **`ai-mcp`** is the *agent bridge*. It depends on `ai-sdk` and is useless without an agent: feed a remote MCP server's tools into an agent, or expose an agent as an MCP server.
- **`mcp`** is for *authoring* MCP servers from scratch - tools, resources, prompts, OAuth - and knows nothing about agents.

Both can "produce an MCP server", but from different inputs (`mcpServerFromAgent(anAgent)` versus a hand-authored server). That overlap is expected, not duplication.

## Versioning

Each package versions independently via Changesets. The API is settling toward `1.0` in the open; the AI family currently tracks the `0.x` line while contracts stabilize. See the [releases](https://github.com/gemstack-land/gemstack/releases) for changelogs.
