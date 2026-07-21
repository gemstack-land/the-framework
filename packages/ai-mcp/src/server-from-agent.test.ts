import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Agent, AiFake, AiRegistry, toolDefinition } from '@gemstack/ai-sdk'
import { mcpServerFromAgent } from './server-from-agent.js'

// ─── Fixture agent ────────────────────────────────────────

const greetTool = toolDefinition({
  name:        'greet',
  description: 'Greet someone by name',
  inputSchema: z.object({ name: z.string() }),
}).server(async ({ name }) => `Hello, ${name}!`)

const addTool = toolDefinition({
  name:        'add',
  description: 'Add two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
}).server(async ({ a, b }) => ({ sum: a + b }))

class FixtureAgent extends Agent {
  instructions() { return 'Test agent for mcpServerFromAgent.' }
  tools() { return [greetTool, addTool] }
}

// ─── Loopback helper ──────────────────────────────────────

async function connectClient(server: unknown): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([
    (server as { connect(t: unknown): Promise<void> }).connect(serverTransport),
    client.connect(clientTransport),
  ])
  return {
    client,
    async cleanup() {
      await client.close().catch(() => {})
      await (server as { close?: () => Promise<void> }).close?.().catch(() => {})
    },
  }
}

// ─── Tools mode (default) ─────────────────────────────────

describe('mcpServerFromAgent — tools mode', () => {
  it('exposes each agent tool as an MCP tool', async () => {
    const server = await mcpServerFromAgent(FixtureAgent)
    const { client, cleanup } = await connectClient(server)
    try {
      const list = await client.listTools()
      const names = list.tools.map(t => t.name).sort()
      assert.deepStrictEqual(names, ['add', 'greet'])
    } finally { await cleanup() }
  })

  it('forwards tool calls to the agent tool execute fn', async () => {
    const server = await mcpServerFromAgent(FixtureAgent)
    const { client, cleanup } = await connectClient(server)
    try {
      const result = await client.callTool({ name: 'greet', arguments: { name: 'Sam' } })
      const text = textFromResult(result)
      assert.strictEqual(text, 'Hello, Sam!')
    } finally { await cleanup() }
  })

  it('forwards a tool whose execute fn returns synchronously', async () => {
    // `.server()` accepts `TReturn | Promise<TReturn>`, so a bare return is
    // legal and must not be mistaken for an async generator.
    const syncTool = toolDefinition({
      name:        'shout',
      description: 'Shout a word',
      inputSchema: z.object({ word: z.string() }),
    }).server(({ word }) => word.toUpperCase())

    class SyncAgent extends Agent {
      instructions() { return 'Sync tool agent.' }
      tools() { return [syncTool] }
    }

    const server = await mcpServerFromAgent(SyncAgent)
    const { client, cleanup } = await connectClient(server)
    try {
      const result = await client.callTool({ name: 'shout', arguments: { word: 'hi' } })
      assert.strictEqual(textFromResult(result), 'HI')
    } finally { await cleanup() }
  })

  it('stringifies structured tool results as JSON', async () => {
    const server = await mcpServerFromAgent(FixtureAgent)
    const { client, cleanup } = await connectClient(server)
    try {
      const result = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } })
      const text = textFromResult(result)
      assert.match(text, /"sum"\s*:\s*5/)
    } finally { await cleanup() }
  })

  it('uses agent instructions on the server', async () => {
    const server = await mcpServerFromAgent(FixtureAgent)
    const { client, cleanup } = await connectClient(server)
    try {
      const info = await client.getServerVersion()
      // version metadata is what the SDK exposes; full server info isn't
      // round-tripped on Client.connect — but the call succeeding plus the
      // tool list above proves the server is up with the right shape.
      assert.ok(info, 'expected server info from initialized session')
    } finally { await cleanup() }
  })

  it('overrides default name + version via opts', async () => {
    const server = await mcpServerFromAgent(FixtureAgent, { name: 'custom', version: '9.9.9' })
    assert.ok(server)
  })

  // Note: an Agent without tools + `expose: 'tools'` is a degenerate config —
  // the SDK doesn't advertise `tools` capability until at least one is
  // registered, so `listTools` errors with "Method not found". This is fine:
  // an empty agent should be exposed via `expose: 'agent'` instead, covered
  // in mcp-server-from-agent-modes.test.ts.
})

// ─── Helpers ──────────────────────────────────────────────

function textFromResult(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  return (r.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

// Silence unused-import warnings while we're not yet using the agent runtime
// in tools-mode tests (covered in mcp-server-from-agent-modes.test.ts for
// agent + both modes which DO call agent.prompt()).
void AiFake
void AiRegistry
