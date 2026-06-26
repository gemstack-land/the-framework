import 'reflect-metadata'
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { serve } from '@hono/node-server'
import { createNodeHandler } from './node-http.js'
import { createHonoApp } from './hono.js'
import { DEMO_TOKEN } from './server.js'

// Drive a full MCP session (initialize handshake + tools/call) with the real
// SDK client, optionally sending a bearer token on every request.
async function roundTrip(baseUrl: string, token?: string): Promise<{ toolNames: string[]; text: string }> {
  const client = new Client({ name: 'quickstart-test', version: '1.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
  )
  // `as never`: the SDK Transport type trips exactOptionalPropertyTypes but is
  // runtime-compatible (see the package's own acceptance test).
  await client.connect(transport as never)
  try {
    const list = await client.listTools()
    const call = await client.callTool({ name: 'greet', arguments: { name: 'Ada' } })
    const content = call.content as Array<{ type: string; text: string }>
    return { toolNames: list.tools.map((t) => t.name), text: content[0]!.text }
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
}

describe('quickstart: node:http (OAuth-protected)', () => {
  let server: Server
  let baseUrl: string

  before(async () => {
    server = createServer(createNodeHandler())
    baseUrl = `http://127.0.0.1:${await listen(server)}`
  })

  after(async () => {
    await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.() })
  })

  it('rejects an unauthenticated request with 401 + WWW-Authenticate', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
      }),
    })
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate') ?? '', /invalid_token/)
    await res.text()
  })

  it('serves tools/call with a valid bearer token (DI resolved)', async () => {
    const { toolNames, text } = await roundTrip(baseUrl, DEMO_TOKEN)
    assert.ok(toolNames.includes('greet'))
    assert.match(text, /Hello, Ada!/)
  })
})

describe('quickstart: Hono (Fetch transport)', () => {
  let server: ReturnType<typeof serve>
  let baseUrl: string

  before(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: createHonoApp().fetch, port: 0 }, (info) => {
        baseUrl = `http://127.0.0.1:${info.port}`
        resolve()
      })
    })
  })

  after(async () => {
    await new Promise<void>((r) => (server as unknown as Server).close(() => r()))
  })

  it('serves the same MCP server mounted on a framework', async () => {
    const { toolNames, text } = await roundTrip(baseUrl) // demo Hono mount is unprotected
    assert.ok(toolNames.includes('greet'))
    assert.match(text, /Hello, Ada!/)
  })
})
