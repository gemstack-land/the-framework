# @gemstack/mcp

## 0.4.0

### Minor Changes

- dad26f4: fix(mcp): stop the web handler attaching an SDK per unauthenticated POST

  `createWebRequestHandler` built a transport + SDK pair and called `attachSdk` for any POST without a known `mcp-session-id`, not just an `initialize`. Nothing ever detached those pairs, so the server's notification set grew by one entry per unauthenticated request. Only an `initialize` opens a session now; anything else is answered `400`/`404` per the streamable-HTTP spec without allocating. A pair that ends up with no registered session (rejected initialize, failed connect) is always released.

  Also: stateful sessions now expire after 30 minutes idle (`sessionIdleMs`), both handlers expose `close()` to tear every live session down, and stateless mode builds one transport per request (the SDK rejects a reused stateless transport) instead of sharing one racily created pair.

- fa15730: Stop trusting `X-Forwarded-Host` in the OAuth 2.1 challenge, and escape `resource_metadata`.

  `absoluteUrl()` read the client-supplied `X-Forwarded-Host` and `X-Forwarded-Proto` first and unconditionally. Its result is the `resource_metadata` URL in the RFC 9728 `WWW-Authenticate` header, which is exactly what a compliant MCP client follows to discover where to authenticate, so anyone able to reach the endpoint could point another client's discovery at a host of their choosing, or downgrade the scheme to `http`. The value was also interpolated unescaped, so a host containing a quote broke out of the RFC 7235 quoted-string and injected `error` and `scope` auth-params ahead of the real ones.

  Forwarded headers are now honoured only when the new `trustProxy` option is set (default off), only the first (client-facing) value of each is read, and a forwarded host that is not a bare `host[:port]` is discarded. `resource_metadata` and `scope` now get the same quoted-string escaping `error_description` already had.

  If you deploy behind a reverse proxy that overwrites those headers and you rely on the forwarded host appearing in the metadata URL, set `trustProxy: true` in your OAuth2 options.

### Patch Changes

- 6f7cf23: Validate tool and prompt arguments against the schema they declare.

  A tool's `schema()` was only ever used to _advertise_ its input shape in `tools/list`. The low-level MCP `Server` validates just the request envelope (`arguments` is an open record on the wire), so `tools/call` handed `handle()` whatever the client sent, regardless of the declared schema. Handlers are written against the declared types and interpolate those values into request paths, so an unchecked argument was a live injection surface: a tool declaring `number: z.number().int().positive()` and building `` `/repos/${owner}/${repo}/issues/${input.number}` `` would happily issue a request for `number: "../../../user/repos"` with the server's credentials.

  `tools/call` and `prompts/get` now check arguments against the declared schema, reject a mismatch with a clear error, and pass the _parsed_ value to the handler, so handlers see coerced values and undeclared keys stripped. Schemas that cannot validate (a plain `{ shape }` rather than a Zod schema) pass through as before. `McpTestClient.callTool` validates identically, so a test can no longer pass arguments a real client would be rejected for.

- 7297961: `matchUriTemplate` no longer lets a percent-encoded separator slip a path traversal past its `[^/]` guard (#968)

  The matcher decoded the captured params after the match had already been accepted, so
  `file://docs/..%2F..%2F..%2Fetc%2Fpasswd` matched `file://docs/{name}` and handed the
  handler `../../../etc/passwd`, while the literal-slash form was correctly rejected. Any
  resource handler that treats a template param as a path segment read outside its root.
  The guard now applies to the decoded value.

  A malformed percent-escape now reports a non-match as well. `decodeURIComponent` was
  called unguarded, so a one-character body like `file://docs/%` threw a `URIError` out of
  the matcher and into the `resources/read` template loop, where a URI that simply does not
  match should fall through cleanly to the next template.

  The same pass escapes the literal parts of the template before they reach the `RegExp`.
  A `.` in a template used to match any character (`weather://a.b/{city}` matched
  `weather://aXb/paris`), and a literal `(` created a capture group that shifted every
  param onto the wrong value. Templates without regex metacharacters behave exactly as
  before.

## 0.3.0

### Minor Changes

- 964e3d8: `resolveOrConstruct` no longer masks a genuine resolver failure with an un-wired instance.

  `McpResolver` gains an optional `has?(token)` hook. When a resolver implements it (the built-in `createResolver` now does), the runtime only routes tokens it owns through `resolve()` when constructing a primitive class, and lets a genuine construction failure (e.g. a missing constructor dependency) propagate loudly instead of silently falling back to `new Token()`. Resolvers without `has` keep the previous behavior — a `resolve` miss (throw or `undefined`) falls back to a plain constructor — so this is backward compatible.

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
