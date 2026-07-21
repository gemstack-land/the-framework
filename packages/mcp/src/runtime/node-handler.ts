import type { IncomingMessage, ServerResponse } from 'node:http'
import type { McpServer } from '../McpServer.js'
import { createWebRequestHandler, type WebRequestHandlerOptions } from './web-handler.js'

export interface McpHttpHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>
  /** Tear down every live session and refuse further requests. Idempotent. */
  close(): Promise<void>
}

/**
 * A framework-neutral `node:http` request handler for an MCP server. Mount it
 * on a raw `http.createServer(...)`, or anywhere a `(req, res)` handler fits
 * (Express, Connect), with no framework present:
 *
 * ```ts
 * import { createServer } from 'node:http'
 * import { createMcpHttpHandler } from '@gemstack/mcp/runtime'
 *
 * const handler = createMcpHttpHandler(new MyServer())
 * createServer((req, res) => { void handler(req, res) }).listen(3000)
 * ```
 *
 * It bridges Node's `IncomingMessage`/`ServerResponse` to the Web Standard
 * `Request`/`Response` that the MCP SDK's streamable-HTTP transport speaks,
 * streaming the response body so SSE notification channels stay open.
 */
export function createMcpHttpHandler(
  server: McpServer,
  options?: WebRequestHandlerOptions,
): McpHttpHandler {
  const handle = createWebRequestHandler(server, options)

  const handler = (async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const request = await toWebRequest(req)
      const response = await handle(request)
      await writeWebResponse(res, response)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
      }
      const message = err instanceof Error ? err.message : String(err)
      res.end(JSON.stringify({ error: 'internal_error', message }))
    }
  }) as McpHttpHandler

  handler.close = () => handle.close()
  return handler
}

/** Build a Web Standard `Request` from a Node `IncomingMessage`. */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = (req.headers['host'] as string | undefined) ?? 'localhost'
  const proto = (firstHeader(req.headers['x-forwarded-proto']) ?? 'http')
  const url = `${proto}://${host}${req.url ?? '/'}`

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }

  const method = req.method ?? 'GET'
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks)
  return body.length > 0
    ? new Request(url, { method, headers, body })
    : new Request(url, { method, headers })
}

/** Stream a Web Standard `Response` back through a Node `ServerResponse`. */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => { headers[key] = value })
  res.writeHead(response.status, headers)

  if (!response.body) {
    res.end()
    return
  }

  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}
