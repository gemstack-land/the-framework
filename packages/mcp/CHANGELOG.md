# @gemstack/mcp

## 0.2.1

### Patch Changes

- 36f56e2: Quality + docs pass for mcp:

  - OAuth: reject an empty bearer token (`Authorization: Bearer ` with no value) up front with a `401 invalid_token` instead of forwarding an empty string to `verifyToken`.
  - Errors thrown when a `@Handle` dependency fails to resolve now chain the original via `{ cause }`.
  - Documented `McpResponse.text/json/error` (and when to prefer `error()` over throwing); neutralized framework-specific wording in the OAuth core docs.
  - README: completed the OAuth 2.1 section (a real `jose`-based `verifyToken`, and that `oauth2McpMiddleware` + `registerOAuth2Metadata` must both be wired), softened the origin framing.

## 0.2.0

### Minor Changes

- f7c7a45: Promote MCP-authoring utilities to the public API so inspectors and tooling no longer need internal access.

  - `McpServer.introspect()`: a public introspection surface returning the registered tool / resource / prompt classes (constructors, not instances) without starting a session. The supported alternative to the internal `_tools()` / `_resources()` / `_prompts()` accessors, which stay `@internal`.
  - `zodToJsonSchema(schema)`: convert a Zod schema to the JSON Schema MCP advertises (exported from the package entry).
  - `matchUriTemplate(template, uri)`: match a URI against a `resource://{template}` pattern and extract params.
  - New `McpServerIntrospection` and `ZodLikeObject` types exported alongside.

  This lets a thin framework binding (e.g. `@rudderjs/mcp`) build a server inspector against the published surface instead of re-declaring internal shapes or carrying local copies of the helpers.

## 0.1.0

### Minor Changes

- 535ae5c: Initial release. An agent-agnostic framework for authoring MCP servers — the graduation of the mature `@rudderjs/mcp` into a standalone, dependency-light package (runtime deps: `@modelcontextprotocol/sdk`, `zod`, `reflect-metadata`; zero `@rudderjs/*`).

  - `McpServer` / `McpTool` / `McpResource` / `McpPrompt` / `McpResponse` / `Mcp` plus the metadata + MCP-spec annotation decorators.
  - **Instance-scoped DI seam**: `@Handle(...)` resolves dependencies through a resolver passed at construction (`new Server({ resolver })`), never off `globalThis`. Built-in `createResolver().register(token, instance)` for the no-container case; a `@Handle` dependency with no resolver (or a resolver yielding `undefined`) fails loudly, naming the member and token — never injects `undefined`.
  - **Framework-neutral HTTP**: `createMcpHttpHandler(server)` returns a plain `node:http` `(req, res)` handler (also fits Express/Connect); `createWebRequestHandler(server)` returns a Web Standard `(request) => Promise<Response>` for Hono/Vike/edge runtimes. `startStdio` for CLI/stdio.
  - **Generic OAuth 2.1**: `oauth2McpMiddleware` takes a user-supplied `verifyToken` (the binding wires its own auth) and emits RFC 9728 protected-resource metadata; no auth provider baked in.
  - `McpTestClient` for in-process testing, and an observer registry for tool/resource/prompt tracing.

  Schema conversion uses Zod 4's native `z.toJSONSchema` directly. The Rudder-specific provider, CLI scaffolders, and doctor check stay in `@rudderjs/mcp`, which becomes a thin binding over this core (Phase 2).
