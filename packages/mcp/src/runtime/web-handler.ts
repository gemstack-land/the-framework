import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '../McpServer.js'
import { createSdkServer } from './sdk-server.js'

type WebTransport = WebStandardStreamableHTTPServerTransport

interface Session {
  transport: WebTransport
  sdk: Server
  detach: () => void
  lastSeen: number
}

/** 30 minutes. The streamable-HTTP spec lets a server end a session at any time; the client re-initializes on the 404. */
const DEFAULT_SESSION_IDLE_MS = 30 * 60_000

export interface WebRequestHandlerOptions {
  /**
   * Session-id generator for stateful mode (defaults to `crypto.randomUUID`).
   * Pass `sessionIdGenerator: undefined` explicitly for **stateless** mode —
   * every request gets its own transport, as the SDK requires.
   */
  sessionIdGenerator?: (() => string) | undefined
  /**
   * How long a stateful session may go without a request before it is dropped
   * (default 30 minutes). A client that vanishes without a `DELETE` would
   * otherwise stay resident forever. `0` or `Infinity` disables expiry.
   */
  sessionIdleMs?: number
  /** @internal Clock hook so tests can age sessions without waiting. */
  now?: () => number
}

export interface WebRequestHandler {
  (request: Request): Promise<Response>
  /**
   * Tear down every live session (detach, close the SDK and the transport) and
   * refuse further requests. Idempotent.
   */
  close(): Promise<void>
}

/**
 * Framework-neutral MCP request handler: maps a Web Standard `Request` to a
 * `Response` using the MCP SDK's streamable-HTTP transport. This is the engine
 * behind {@link createMcpHttpHandler} (raw `node:http`) and any binding that can
 * hand it a `Request` (Hono, Vike, the Fetch API, edge runtimes).
 *
 * ### Session lifecycle
 * - **Stateful** (default) — only an `initialize` POST may open a session; any
 *   other request without a live session id is answered `400`/`404` without
 *   building anything. A session is torn down on `onsessionclosed`, on idle
 *   expiry ({@link WebRequestHandlerOptions.sessionIdleMs}), or on `close()`.
 * - **Stateless** (`sessionIdGenerator: undefined`) — a transport + SDK pair per
 *   request, released once that request's response body ends. The SDK rejects a
 *   reused stateless transport (request-id collisions), so no pair is shared.
 */
export function createWebRequestHandler(
  server: McpServer,
  options?: WebRequestHandlerOptions,
): WebRequestHandler {
  const sessions = new Map<string, Session>()
  const stateless = !!options && 'sessionIdGenerator' in options && options.sessionIdGenerator === undefined
  const sessionIdGen = stateless ? undefined : (options?.sessionIdGenerator ?? (() => crypto.randomUUID()))
  const now = options?.now ?? (() => Date.now())
  const idleMs = options?.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS

  const transient = new Set<Session>()
  let TransportCtor: typeof WebStandardStreamableHTTPServerTransport | undefined
  let closed = false

  async function transportCtor(): Promise<typeof WebStandardStreamableHTTPServerTransport> {
    if (!TransportCtor) {
      ({ WebStandardStreamableHTTPServerTransport: TransportCtor } = await import(
        '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
      ))
    }
    return TransportCtor
  }

  /** Connect an SDK to a transport and attach it, releasing both if connecting throws. */
  async function connect(transport: WebTransport): Promise<Session> {
    const sdk = createSdkServer(server)
    let detach: (() => void) | undefined
    try {
      await sdk.connect(transport)
      detach = server.attachSdk(sdk)
      return { transport, sdk, detach, lastSeen: now() }
    } catch (err) {
      detach?.()
      await sdk.close().catch(() => {})
      await transport.close().catch(() => {})
      throw err
    }
  }

  /** The one place a pair is released, so `detach` can never be skipped. */
  async function discard(session: Session): Promise<void> {
    transient.delete(session)
    session.detach()
    await session.sdk.close().catch(() => {})
    await session.transport.close().catch(() => {})
  }

  /** Release the pair when its response body ends, so a streaming reply is not cut short. */
  function releaseWithBody(response: Response, session: Session): Response {
    if (!response.body) {
      void discard(session)
      return response
    }
    const release = (): void => { void discard(session) }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            controller.close()
            release()
            return
          }
          controller.enqueue(chunk.value)
        } catch (err) {
          controller.error(err)
          release()
        }
      },
      cancel(reason) {
        void reader.cancel(reason)
        release()
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  function sweepExpired(): void {
    if (!(idleMs > 0) || !Number.isFinite(idleMs)) return
    const cutoff = now() - idleMs
    for (const [id, session] of sessions) {
      if (session.lastSeen <= cutoff) {
        sessions.delete(id)
        void discard(session)
      }
    }
  }

  const handler = (async (request: Request): Promise<Response> => {
    if (closed) return jsonRpcError(503, -32000, 'Service Unavailable: handler closed')
    const Transport = await transportCtor()

    // Stateless: a pair per request. Sharing one was both racy and, since SDK
    // 1.29, fatal — a reused stateless transport throws on the second request.
    if (!sessionIdGen) {
      const transport = new Transport()
      const session = await connect(transport)
      transient.add(session)
      try {
        return releaseWithBody(await transport.handleRequest(request), session)
      } catch (err) {
        await discard(session)
        throw err
      }
    }

    sweepExpired()

    // Stateful: route by session-id header.
    const sessionId = request.headers.get('mcp-session-id')
    const live = sessionId ? sessions.get(sessionId) : undefined
    if (live) {
      live.lastSeen = now()
      return live.transport.handleRequest(request)
    }

    // Only an `initialize` may open a session. Building the pair for anything
    // else attached an SDK that nothing ever detached (#970).
    if (request.method !== 'POST') return unknownSession(sessionId)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonRpcError(400, -32700, 'Parse error: Invalid JSON')
    }
    if (!opensSession(body)) return unknownSession(sessionId)

    // `detach` is captured in a closure so `onsessionclosed` can release the
    // attached SDK without holding a stale reference.
    let opened: Session | undefined
    const transport = new Transport({
      sessionIdGenerator: sessionIdGen,
      onsessioninitialized: (id: string) => { if (opened) sessions.set(id, opened) },
      onsessionclosed: (id: string) => {
        sessions.delete(id)
        opened?.detach()
      },
    })
    const session = await connect(transport)
    opened = session

    let response: Response
    try {
      response = await transport.handleRequest(request, { parsedBody: body })
    } catch (err) {
      await discard(session)
      throw err
    }

    // A rejected initialize (bad Accept header, malformed params, ...) registers
    // no session, so nothing else would ever release this pair.
    const id = transport.sessionId
    if (!id || sessions.get(id) !== session) await discard(session)
    return response
  }) as WebRequestHandler

  handler.close = async (): Promise<void> => {
    closed = true
    const live = [...sessions.values(), ...transient]
    sessions.clear()
    await Promise.all(live.map(discard))
  }

  return handler
}

/** Loose check: the transport still validates the payload, this only decides whether a session may open. */
function opensSession(body: unknown): boolean {
  const isInit = (message: unknown): boolean =>
    !!message && typeof message === 'object' && (message as { method?: unknown }).method === 'initialize'
  return Array.isArray(body) ? body.some(isInit) : isInit(body)
}

/** Mirrors the transport's own session errors so clients see one wire format. */
function unknownSession(sessionId: string | null): Response {
  return sessionId
    ? jsonRpcError(404, -32001, 'Session not found')
    : jsonRpcError(400, -32000, 'Bad Request: Mcp-Session-Id header is required')
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
