export { McpServer } from './McpServer.js'
export type { McpServerMetadata, McpServerOptions, McpServerIntrospection } from './McpServer.js'
export { McpTool } from './McpTool.js'
export type { McpToolResult, McpToolProgress, McpToolReturn } from './McpTool.js'
export { McpResource } from './McpResource.js'
export { McpPrompt } from './McpPrompt.js'
export type { McpPromptMessage } from './McpPrompt.js'
export { McpResponse } from './McpResponse.js'
export { Mcp } from './Mcp.js'
export type { McpWebEntry, McpWebBuilder } from './Mcp.js'
export {
  Name, Version, Instructions, Description, Handle,
  IsReadOnly, IsDestructive, IsIdempotent, IsOpenWorld,
  Audience, Priority, LastModified,
} from './decorators.js'
export type { InjectToken, ToolAnnotations, ResourceAnnotations, AudienceRole } from './decorators.js'
// DI seam: supply a resolver to a server (or McpTestClient) to inject @Handle deps.
export { createResolver } from './resolver.js'
export type { McpResolver, MutableResolver } from './resolver.js'
// OAuth 2.1 protection for web endpoints (bring your own `verifyToken`).
export { oauth2McpMiddleware, registerOAuth2Metadata } from './auth/oauth2.js'
export type {
  OAuth2McpOptions, VerifyToken, VerifiedToken, McpAuthContext,
  OAuth2Request, OAuth2Response, OAuth2Next, OAuth2Middleware,
} from './auth/oauth2.js'
// Framework-neutral HTTP handler — mount an MCP server on raw `node:http`,
// Express, Connect, etc. The SDK-wiring runtime primitives (createSdkServer,
// startStdio, createWebRequestHandler) live at `@gemstack/mcp/runtime` so the
// main entry doesn't pull `@modelcontextprotocol/sdk` into the boot path.
export { createMcpHttpHandler, type McpHttpHandler } from './runtime/node-handler.js'
export { McpTestClient } from './testing.js'
export type { McpTestClientOptions } from './testing.js'
export type { McpObserverEvent, McpObserver, McpObserverRegistry } from './observers.js'
// MCP-authoring utilities, useful for custom inspectors / tooling built on the
// core: convert a Zod schema to the JSON Schema MCP advertises, and match a URI
// against a `resource://{template}` pattern. Both are pure and dependency-light.
export { zodToJsonSchema } from './zod-to-json-schema.js'
export type { ZodLikeObject } from './types.js'
export { matchUriTemplate } from './uri-template.js'
