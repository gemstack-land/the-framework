import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { McpServer } from '../McpServer.js'
import { McpTool } from '../McpTool.js'
import { McpResponse } from '../McpResponse.js'
import type { McpNotificationTarget } from '../McpServer.js'
import { createWebRequestHandler } from './web-handler.js'

class EchoTool extends McpTool {
  schema() { return z.object({ message: z.string() }) }
  async handle(input: Record<string, unknown>) { return McpResponse.text(String(input['message'])) }
}
class TestServer extends McpServer { protected tools = [EchoTool] }

/** Counts attach/detach so a leaked SDK is visible without reaching into the server's private set. */
function countingServer() {
  const server = new TestServer()
  const counts = { attached: 0, detached: 0 }
  const attach = server.attachSdk.bind(server)
  server.attachSdk = (target: McpNotificationTarget) => {
    counts.attached++
    const detach = attach(target)
    return () => { counts.detached++; detach() }
  }
  return { server, counts }
}

const MCP_HEADERS = {
  accept: 'application/json, text/event-stream',
  'content-type': 'application/json',
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(body),
  })
}

const INITIALIZE = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1.0.0' } },
}
const TOOLS_CALL = {
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'echo', arguments: { message: 'hi' } },
}

test('a non-initialize POST never builds or attaches an SDK (#970)', async () => {
  const { server, counts } = countingServer()
  const handler = createWebRequestHandler(server)

  for (let i = 0; i < 5; i++) {
    const res = await handler(post(TOOLS_CALL))
    assert.equal(res.status, 400)
  }
  assert.equal(counts.attached, 0, 'unauthenticated requests must not attach an SDK')

  // ...and a bogus session id is a 404, not a fresh session.
  const bogus = await handler(post(TOOLS_CALL, { 'mcp-session-id': 'nope' }))
  assert.equal(bogus.status, 404)
  assert.equal(counts.attached, 0, 'a bogus session id must not attach an SDK')
  await handler.close()
})

test('an initialize opens exactly one session, and close() detaches it', async () => {
  const { server, counts } = countingServer()
  const handler = createWebRequestHandler(server)

  const res = await handler(post(INITIALIZE))
  assert.equal(res.status, 200)
  const sessionId = res.headers.get('mcp-session-id')
  assert.ok(sessionId, 'initialize must mint a session id')
  await res.body?.cancel()
  assert.equal(counts.attached, 1)
  assert.equal(counts.detached, 0)

  await handler.close()
  assert.equal(counts.detached, 1, 'close() must detach every live session')
  assert.equal((await handler(post(INITIALIZE))).status, 503)
})

test('a rejected initialize leaves nothing attached', async () => {
  const { server, counts } = countingServer()
  const handler = createWebRequestHandler(server)

  // No `text/event-stream` in Accept: the transport rejects it and no session is registered.
  const res = await handler(post(INITIALIZE, { accept: 'application/json' }))
  assert.equal(res.status, 406)
  assert.equal(counts.attached, 1, 'the pair is built for an initialize')
  assert.equal(counts.detached, 1, 'and released again when no session is registered')
  await handler.close()
})

test('stateless mode gives every request its own transport and releases it (#970)', async () => {
  const { server, counts } = countingServer()
  const handler = createWebRequestHandler(server, { sessionIdGenerator: undefined })

  // Concurrent first requests: sharing one pair orphaned the loser (and the SDK
  // rejects a reused stateless transport outright).
  const responses = await Promise.all([handler(post(INITIALIZE)), handler(post(INITIALIZE))])
  for (const res of responses) {
    assert.equal(res.status, 200)
    await res.text()
  }
  // A later request must still be served rather than reusing a spent transport.
  const third = await handler(post(INITIALIZE))
  assert.equal(third.status, 200)
  await third.text()

  assert.equal(counts.attached, 3)
  assert.equal(counts.detached, 3, 'every stateless pair must be released with its response')
  await handler.close()
})

test('an idle session expires and is detached', async () => {
  const { server, counts } = countingServer()
  let clock = 1_000
  const handler = createWebRequestHandler(server, { sessionIdleMs: 60_000, now: () => clock })

  const res = await handler(post(INITIALIZE))
  const sessionId = res.headers.get('mcp-session-id')!
  await res.body?.cancel()
  assert.equal(counts.attached, 1)

  // Still fresh: the session survives and keeps serving.
  clock += 30_000
  const fresh = await handler(post(TOOLS_CALL, { 'mcp-session-id': sessionId }))
  assert.notEqual(fresh.status, 404)
  await fresh.body?.cancel()
  assert.equal(counts.detached, 0)

  // Past the idle window: the next request sweeps it.
  clock += 60_001
  const gone = await handler(post(TOOLS_CALL, { 'mcp-session-id': sessionId }))
  assert.equal(gone.status, 404)
  assert.equal(counts.detached, 1, 'an expired session must be detached, not just forgotten')
  await handler.close()
})
