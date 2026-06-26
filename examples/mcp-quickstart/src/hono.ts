import 'reflect-metadata'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { createWebRequestHandler } from '@gemstack/mcp/runtime'
import { makeServer } from './server.js'

// The same server, mounted on a framework via the Fetch-style handler. This
// proves @gemstack/mcp is transport-agnostic: createWebRequestHandler returns a
// `(Request) => Promise<Response>`, which is what Hono (and Vike, Bun, Deno,
// Cloudflare Workers) speak natively.
//
// This demo mount is unprotected to keep it short. To protect the Fetch path,
// read the Authorization header in a Hono middleware and call the SAME
// verifyToken from ./server.js before delegating to the handler.
export function createHonoApp(): Hono {
  const app = new Hono()
  const handler = createWebRequestHandler(makeServer())
  app.all('/mcp', (c) => handler(c.req.raw))
  return app
}

// Runnable on Node via @hono/node-server: `npx tsx src/hono.ts`.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { serve } = await import('@hono/node-server')
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: createHonoApp().fetch, port }, (info) => {
    console.log(`MCP server on http://localhost:${info.port}/mcp (Hono)`)
  })
}
