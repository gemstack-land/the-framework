import type { McpServer, McpServerOptions } from './McpServer.js'
import type { OAuth2McpOptions } from './auth/oauth2.js'
import type { McpResolver } from './resolver.js'

type ServerClass = new (options?: McpServerOptions) => McpServer

export interface McpWebEntry {
  server: ServerClass
  middleware: unknown[]
  /** Set when `.oauth2()` was chained on the builder. */
  oauth2?: OAuth2McpOptions
  /** Set when `.resolver()` was chained — the DI resolver to construct the server with. */
  resolver?: McpResolver
}

export interface McpWebBuilder {
  /** Add middleware to this web MCP endpoint. */
  middleware(mw: unknown[]): McpWebBuilder
  /**
   * Protect this endpoint with OAuth 2.1 bearer tokens. Registers an RFC 9728
   * Protected Resource Metadata endpoint alongside it. Supply a `verifyToken`
   * (see {@link OAuth2McpOptions}) so the endpoint can validate bearer tokens.
   */
  oauth2(options?: OAuth2McpOptions): McpWebBuilder
  /** Construct this server with a DI resolver (for `@Handle()` dependencies). */
  resolver(resolver: McpResolver): McpWebBuilder
}

/**
 * Shared singleton store routed through `globalThis` so the registry survives
 * the case where `@gemstack/mcp` is loaded twice — typical in a bundled server
 * where the host inlines `@gemstack/mcp` but `Mcp.web()` / `Mcp.local()` calls
 * run from a separate `node_modules` copy. Without a shared store, servers
 * registered from one copy would be invisible to the mounter reading the other
 * — every `/mcp/*` request would 404.
 */
interface McpServersStore {
  web: Map<string, McpWebEntry>
  local: Map<string, ServerClass>
}

const _g = globalThis as Record<string, unknown>
if (!_g['__gemstack_mcp_servers__']) {
  _g['__gemstack_mcp_servers__'] = {
    web: new Map<string, McpWebEntry>(),
    local: new Map<string, ServerClass>(),
  } satisfies McpServersStore
}
const _store = _g['__gemstack_mcp_servers__'] as McpServersStore

export class Mcp {
  /** Register an MCP server on an HTTP endpoint (Streamable HTTP transport) */
  static web(path: string, server: ServerClass, middleware: unknown[] = []): McpWebBuilder {
    const entry: McpWebEntry = { server, middleware }
    _store.web.set(path, entry)
    const builder: McpWebBuilder = {
      middleware(mw: unknown[]) {
        entry.middleware.push(...mw)
        return builder
      },
      oauth2(options: OAuth2McpOptions = {}) {
        entry.oauth2 = options
        return builder
      },
      resolver(resolver: McpResolver) {
        entry.resolver = resolver
        return builder
      },
    }
    return builder
  }

  /** Register an MCP server as a local CLI command (stdio transport) */
  static local(name: string, server: ServerClass): void {
    _store.local.set(name, server)
  }

  static getWebServers(): Map<string, McpWebEntry> { return _store.web }
  static getLocalServers(): Map<string, ServerClass> { return _store.local }
}
