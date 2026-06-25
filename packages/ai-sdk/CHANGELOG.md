# @gemstack/ai-sdk

## 0.3.0

### Minor Changes

- 9da9b29: Remove the `./mcp` subpath. The agent<->MCP bridge (`mcpClientTools` / `mcpServerFromAgent`) has moved to its own package, `@gemstack/ai-mcp`, so the optional `@modelcontextprotocol/sdk` peer dependency is now declared only by the package that uses it (and no longer surfaces to every `@gemstack/ai-sdk` consumer).

  Migration: replace `@gemstack/ai-sdk/mcp` imports with `@gemstack/ai-mcp`, and move the `@modelcontextprotocol/sdk` peer to that package. The bridge API is unchanged.

## 0.2.0

### Minor Changes

- e867923: Decouple the core from Rudder: `@gemstack/ai-sdk`'s only required runtime dependency is now `zod`. Schema conversion uses Zod 4's native `z.toJSONSchema` directly instead of `@rudderjs/json-schema` (dependency removed). `@rudderjs/console` is demoted from a hard dependency to an optional peer (only the `/doctor` check and `/commands/make-agent` scaffolder use it). `@rudderjs/core` (`/server` provider) and `@rudderjs/orm` (the `*-orm` stores) remain optional peers behind their opt-in subpaths. A non-Rudder app can now install and use the SDK with zero `@rudderjs/*` packages. No public API change on the main entry.
