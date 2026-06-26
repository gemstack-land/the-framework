import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '../McpServer.js'
import { createSdkServer } from './sdk-server.js'

type WebTransport = WebStandardStreamableHTTPServerTransport

export interface WebRequestHandlerOptions {
  /**
   * Session-id generator for stateful mode (defaults to `crypto.randomUUID`).
   * Pass `sessionIdGenerator: undefined` explicitly for **stateless** mode — a
   * single transport is created lazily and reused for the handler's lifetime.
   */
  sessionIdGenerator?: (() => string) | undefined
}

/**
 * Framework-neutral MCP request handler: maps a Web Standard `Request` to a
 * `Response` using the MCP SDK's streamable-HTTP transport. This is the engine
 * behind {@link createMcpHttpHandler} (raw `node:http`) and any binding that can
 * hand it a `Request` (Hono, Vike, the Fetch API, edge runtimes).
 *
 * ### Session lifecycle
 * - **Stateful** (default) — each new client gets a fresh transport + SDK pair,
 *   stored once the SDK fires `onsessioninitialized`; both are torn down on
 *   `onsessionclosed`.
 * - **Stateless** (`sessionIdGenerator: undefined`) — one transport + SDK pair,
 *   created on the first request and reused (never detached).
 */
export function createWebRequestHandler(
  server: McpServer,
  options?: WebRequestHandlerOptions,
): (request: Request) => Promise<Response> {
  const sessions = new Map<string, { transport: WebTransport; sdk: Server }>()
  const stateless = !!options && 'sessionIdGenerator' in options && options.sessionIdGenerator === undefined
  const sessionIdGen = stateless ? undefined : (options?.sessionIdGenerator ?? (() => crypto.randomUUID()))

  let TransportCtor: typeof WebStandardStreamableHTTPServerTransport | undefined

  return async (request: Request): Promise<Response> => {
    if (!TransportCtor) {
      ({ WebStandardStreamableHTTPServerTransport: TransportCtor } = await import(
        '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
      ))
    }

    // Stateless: one transport reused for the handler's lifetime.
    if (!sessionIdGen) {
      let entry = sessions.get('__stateless__')
      if (!entry) {
        const transport = new TransportCtor()
        const sdk = createSdkServer(server)
        await sdk.connect(transport)
        server.attachSdk(sdk)
        entry = { transport, sdk }
        sessions.set('__stateless__', entry)
      }
      return entry.transport.handleRequest(request)
    }

    // Stateful: route by session-id header.
    const sessionId = request.headers.get('mcp-session-id')
    if (sessionId && sessions.has(sessionId)) {
      return sessions.get(sessionId)!.transport.handleRequest(request)
    }

    // New session — `detach` is captured in a closure so `onsessionclosed` can
    // release the attached SDK without holding a stale reference.
    let detach: () => void = () => {}
    const transport = new TransportCtor({
      sessionIdGenerator: sessionIdGen,
      onsessioninitialized: (id: string) => { sessions.set(id, { transport, sdk }) },
      onsessionclosed: (id: string) => { sessions.delete(id); detach() },
    })
    const sdk = createSdkServer(server)
    await sdk.connect(transport)
    detach = server.attachSdk(sdk)
    return transport.handleRequest(request)
  }
}
