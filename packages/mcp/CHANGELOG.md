# @gemstack/mcp

## 0.1.0

### Minor Changes

- 535ae5c: Initial release. An agent-agnostic framework for authoring MCP servers — the graduation of the mature `@rudderjs/mcp` into a standalone, dependency-light package (runtime deps: `@modelcontextprotocol/sdk`, `zod`, `reflect-metadata`; zero `@rudderjs/*`).

  - `McpServer` / `McpTool` / `McpResource` / `McpPrompt` / `McpResponse` / `Mcp` plus the metadata + MCP-spec annotation decorators.
  - **Instance-scoped DI seam**: `@Handle(...)` resolves dependencies through a resolver passed at construction (`new Server({ resolver })`), never off `globalThis`. Built-in `createResolver().register(token, instance)` for the no-container case; a `@Handle` dependency with no resolver (or a resolver yielding `undefined`) fails loudly, naming the member and token — never injects `undefined`.
  - **Framework-neutral HTTP**: `createMcpHttpHandler(server)` returns a plain `node:http` `(req, res)` handler (also fits Express/Connect); `createWebRequestHandler(server)` returns a Web Standard `(request) => Promise<Response>` for Hono/Vike/edge runtimes. `startStdio` for CLI/stdio.
  - **Generic OAuth 2.1**: `oauth2McpMiddleware` takes a user-supplied `verifyToken` (the binding wires its own auth) and emits RFC 9728 protected-resource metadata; no auth provider baked in.
  - `McpTestClient` for in-process testing, and an observer registry for tool/resource/prompt tracing.

  Schema conversion uses Zod 4's native `z.toJSONSchema` directly. The Rudder-specific provider, CLI scaffolders, and doctor check stay in `@rudderjs/mcp`, which becomes a thin binding over this core (Phase 2).
