import 'reflect-metadata'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { McpTestClient } from '@gemstack/mcp/testing'
import { defineConnector, mountConnectors, McpResponse } from './index.js'
import type { ConnectorContext } from './index.js'
import { createMcpHttpHandler } from '@gemstack/mcp'
import { createWebRequestHandler } from '@gemstack/mcp/runtime'
import type { McpToolResult } from '@gemstack/mcp'

function txt(result: McpToolResult): string {
  const first = result.content[0]
  return first && first.type === 'text' ? first.text : ''
}

// A trivial read-only in-memory connector used across the suite.
function notesConnector() {
  const notes = ['buy milk', 'ship connectors']
  return defineConnector({
    id: 'notes',
    name: 'Notes',
    auth: { type: 'none' },
    tools: [
      {
        name: 'list',
        description: 'List all notes',
        schema: z.object({}),
        annotations: { readOnly: true },
        handle: () => notes,
      },
      {
        name: 'get',
        description: 'Get one note by index',
        schema: z.object({ index: z.number() }),
        annotations: { readOnly: true },
        handle: (input: { index: number }) => notes[input.index] ?? 'not found',
      },
    ],
  })
}

test('defineConnector fills defaults', () => {
  const c = defineConnector({ id: 'x', tools: [{ name: 'ping', schema: z.object({}), handle: () => 'pong' }] })
  assert.equal(c.name, 'x')
  assert.equal(c.version, '1.0.0')
  assert.deepEqual(c.auth, { type: 'none' })
})

test('defineConnector rejects bad ids, empty tools, and dup tool names', () => {
  assert.throws(() => defineConnector({ id: 'Bad Id', tools: [{ name: 'a', schema: z.object({}), handle: () => '' }] }))
  assert.throws(() => defineConnector({ id: 'ok', tools: [] }))
  assert.throws(() =>
    defineConnector({
      id: 'ok',
      tools: [
        { name: 'dup', schema: z.object({}), handle: () => '' },
        { name: 'dup', schema: z.object({}), handle: () => '' },
      ],
    }),
  )
})

test('mountConnectors namespaces tool names by connector id', async () => {
  const client = new McpTestClient(mountConnectors([notesConnector()]))
  const names = (await client.listTools()).map((t) => t.name).sort()
  assert.deepEqual(names, ['notes_get', 'notes_list'])
})

test('namespace: none keeps tool names verbatim', async () => {
  const client = new McpTestClient(mountConnectors([notesConnector()], { namespace: 'none' }))
  const names = (await client.listTools()).map((t) => t.name).sort()
  assert.deepEqual(names, ['get', 'list'])
})

test('handler return values normalize to MCP results', async () => {
  const client = new McpTestClient(mountConnectors([notesConnector()]))
  const list = await client.callTool('notes_list')
  assert.match(txt(list), /buy milk/)
  const one = await client.callTool('notes_get', { index: 1 })
  assert.equal(txt(one), 'ship connectors')
})

test('credentials provider threads auth into the tool context', async () => {
  let captured: ConnectorContext | undefined
  const probe = defineConnector({
    id: 'probe',
    auth: { type: 'pat' },
    tools: [
      {
        name: 'whoami',
        schema: z.object({}),
        handle: (_input, ctx) => {
          captured = ctx
          return ctx.auth.token ?? 'anonymous'
        },
      },
    ],
  })
  const client = new McpTestClient(
    mountConnectors([probe], { credentials: (id) => ({ token: `tok-${id}` }) }),
  )
  const res = await client.callTool('probe_whoami')
  assert.equal(txt(res), 'tok-probe')
  assert.equal(captured?.connectorId, 'probe')
  assert.equal(captured?.auth.token, 'tok-probe')
})

test('annotations are advertised to clients', async () => {
  const client = new McpTestClient(mountConnectors([notesConnector()]))
  const list = (await client.listTools()).find((t) => t.name === 'notes_list')
  assert.equal(list?.annotations?.readOnlyHint, true)
})

test('a handler returning McpResponse.error surfaces as an MCP error result', async () => {
  const c = defineConnector({
    id: 'guard',
    tools: [
      {
        name: 'check',
        schema: z.object({}),
        handle: () => McpResponse.error('not allowed'),
      },
    ],
  })
  const res = await new McpTestClient(mountConnectors([c])).callTool('guard_check')
  assert.equal(res.isError, true)
  assert.equal(txt(res), 'Error: not allowed')
})

test('mountConnectors rejects cross-connector name collisions without namespacing', () => {
  const a = defineConnector({ id: 'a', tools: [{ name: 'x', schema: z.object({}), handle: () => '' }] })
  const b = defineConnector({ id: 'b', tools: [{ name: 'x', schema: z.object({}), handle: () => '' }] })
  // 'a' and 'b' both expose 'x'; with namespace: 'none' the names collide.
  assert.throws(() => mountConnectors([a, b], { namespace: 'none' }))
})

function connectorWith(id: string, name: string, instructions: string) {
  return defineConnector({
    id,
    name,
    instructions,
    tools: [{ name: 'ping', schema: z.object({}), handle: () => 'pong' }],
  })
}

test('mountConnectors aggregates each connector\'s instructions under its name', () => {
  const Server = mountConnectors([
    connectorWith('gh', 'GitHub', 'Act on issues and PRs.'),
    connectorWith('gd', 'Drive', 'Browse and share files.'),
  ])
  const { instructions } = new Server().metadata()
  assert.equal(instructions, '## GitHub\nAct on issues and PRs.\n\n## Drive\nBrowse and share files.')
})

test('mountConnectors puts server-level instructions before per-connector ones', () => {
  const Server = mountConnectors([connectorWith('gh', 'GitHub', 'Act on issues and PRs.')], {
    instructions: 'You have external connectors.',
  })
  const { instructions } = new Server().metadata()
  assert.equal(instructions, 'You have external connectors.\n\n## GitHub\nAct on issues and PRs.')
})

test('mountConnectors omits instructions when no connector or server sets any', () => {
  const Server = mountConnectors([notesConnector()])
  assert.equal(new Server().metadata().instructions, undefined)
})

// ─── mountConnectors -> a real transport handler ──────────
// The docs tell you to mount the returned class on a transport. These pin the
// shape the handler factories actually accept (an INSTANCE, not the class), so
// the mount snippets can't drift away from the API again (#976).

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

/** Both JSON and SSE bodies carry one JSON-RPC payload; pull it out either way. */
async function rpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const line = text.split('\n').find((l) => l.startsWith('data:'))
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<string, unknown>
}

test('a mounted connector server serves a real MCP session over createWebRequestHandler', async () => {
  const Server = mountConnectors([notesConnector()])
  const handler = createWebRequestHandler(new Server())

  const init = await handler(post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1.0.0' } },
  }))
  assert.equal(init.status, 200)
  const sessionId = init.headers.get('mcp-session-id')
  assert.ok(sessionId, 'initialize must mint a session id')
  await init.body?.cancel()

  const listed = await rpc(await handler(post(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { 'mcp-session-id': sessionId },
  )))
  const tools = (listed['result'] as { tools: { name: string }[] }).tools
  assert.deepEqual(tools.map((t) => t.name).sort(), ['notes_get', 'notes_list'])

  const called = await rpc(await handler(post(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'notes_get', arguments: { index: 0 } } },
    { 'mcp-session-id': sessionId },
  )))
  assert.equal(txt(called['result'] as McpToolResult), 'buy milk')

  await handler.close()
})

test('a mounted connector server is accepted by createMcpHttpHandler (the node:http mount)', async () => {
  const Server = mountConnectors([notesConnector()])
  const handler = createMcpHttpHandler(new Server())
  assert.equal(typeof handler, 'function')
  await handler.close()
})
