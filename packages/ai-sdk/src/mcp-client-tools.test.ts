import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { mcpClientTools } from './mcp/client-tools.js'
import { toolToSchema } from './tool.js'

// ─── Helpers ─────────────────────────────────────────────

async function buildLoopback(): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'fixture', version: '1.0.0' })

  // Tool 1 — `weather`: simple string-in / structured-out
  server.registerTool('weather', {
    title:       'Weather',
    description: 'Look up current weather for a city',
    inputSchema: { city: z.string().describe('City name') },
  }, async ({ city }) => ({
    content: [{ type: 'text' as const, text: `${city}: 72°F sunny` }],
  }))

  // Tool 2 — `echo_int`: validates the input arrived as a number
  server.registerTool('echo_int', {
    title:       'Echo int',
    description: 'Echoes a number back',
    inputSchema: { n: z.number() },
  }, async ({ n }) => ({
    content: [{ type: 'text' as const, text: `n=${n}` }],
  }))

  // Tool 3 — `long_task`: streams progress via the SDK's `sendNotification`
  // helper. The SDK Client picks these up via the `onprogress` callback our
  // bridge wires for streaming tools.
  server.registerTool('long_task', {
    title:       'Long task',
    description: 'Streams progress, then returns done',
    inputSchema: { steps: z.number() },
  }, async ({ steps }, ctx) => {
    for (let i = 1; i <= steps; i++) {
      const token = ctx._meta?.['progressToken'] as string | number | undefined
      if (token !== undefined && ctx.sendNotification) {
        await ctx.sendNotification({
          method: 'notifications/progress',
          params: { progressToken: token, progress: i, total: steps, message: `step ${i}` },
        })
      }
    }
    return { content: [{ type: 'text' as const, text: `done in ${steps} steps` }] }
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])

  return {
    client,
    async cleanup() {
      await client.close().catch(() => {})
      await server.close().catch(() => {})
    },
  }
}

// ─── mcpClientTools — caller-owned client ────────────────

describe('mcpClientTools (caller-owned client)', () => {
  it('lists remote tools and returns them as Tools', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client)
      assert.strictEqual(tools.length, 3)
      const names = tools.map(t => t.definition.name).sort()
      assert.deepStrictEqual(names, ['echo_int', 'long_task', 'weather'])
    } finally { await cleanup() }
  })

  it('preserves the remote JSON Schema verbatim via jsonSchema passthrough', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client)
      const weather = tools.find(t => t.definition.name === 'weather')!
      const schema = toolToSchema(weather).parameters as Record<string, unknown>
      assert.strictEqual(schema['type'], 'object')
      const props = schema['properties'] as Record<string, { type: string }>
      assert.strictEqual(props['city']?.type, 'string')
    } finally { await cleanup() }
  })

  it('executes a remote tool and returns text content as a string', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client)
      const weather = tools.find(t => t.definition.name === 'weather')!
      const result = await runTool(weather, { city: 'Boston' })
      assert.strictEqual(result, 'Boston: 72°F sunny')
    } finally { await cleanup() }
  })

  it('forwards remote errors and reports them as [error] strings', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client)
      const echoInt = tools.find(t => t.definition.name === 'echo_int')!
      // Pass a bad type — the SDK schema-validates and returns isError.
      const result = await runTool(echoInt, { n: 'not-a-number' })
      assert.match(result, /\[error\]/i)
    } finally { await cleanup() }
  })

  it('does not expose a close() helper when the client is caller-owned', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client)
      assert.strictEqual((tools as { close?: unknown }).close, undefined)
    } finally { await cleanup() }
  })

  it('filter option drops tools', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client, { filter: (n) => n === 'weather' })
      assert.strictEqual(tools.length, 1)
      assert.strictEqual(tools[0]!.definition.name, 'weather')
    } finally { await cleanup() }
  })

  it('namePrefix prefixes the local tool name without changing the remote name', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client, { namePrefix: 'remote_' })
      const weather = tools.find(t => t.definition.name === 'remote_weather')!
      assert.ok(weather)
      // Remote call still works (uses the un-prefixed name internally)
      const result = await runTool(weather, { city: 'Chicago' })
      assert.match(result, /Chicago/)
    } finally { await cleanup() }
  })

  it('streaming: forwards remote progress notifications as tool-update yields', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client, { streaming: true })
      const longTask = tools.find(t => t.definition.name === 'long_task')!
      const { yields, result } = await runStreamingTool(longTask, { steps: 3 })
      assert.deepStrictEqual(yields.map(y => y.progress), [1, 2, 3])
      assert.strictEqual(result, 'done in 3 steps')
    } finally { await cleanup() }
  })

  it('streaming: false skips progress collection', async () => {
    const { client, cleanup } = await buildLoopback()
    try {
      const tools = await mcpClientTools(client, { streaming: false })
      const longTask = tools.find(t => t.definition.name === 'long_task')!
      const result = await runTool(longTask, { steps: 2 })
      assert.strictEqual(result, 'done in 2 steps')
    } finally { await cleanup() }
  })
})

// ─── Helpers — invoke a Tool's execute through the same shape the agent loop uses

async function runTool(tool: { execute?: unknown }, input: unknown): Promise<string> {
  const fn = tool.execute as (input: unknown) => unknown
  const out = fn(input)
  if (out instanceof Promise) return (await out) as string
  // Generator path — drain yields, return final
  const iter = out as AsyncGenerator<unknown, string, void>
  let next = await iter.next()
  while (!next.done) next = await iter.next()
  return next.value
}

async function runStreamingTool(
  tool: { execute?: unknown },
  input: unknown,
): Promise<{ yields: Array<{ progress: number; total?: number; message?: string }>; result: string }> {
  const fn = tool.execute as (input: unknown) => AsyncGenerator<{ progress: number; total?: number; message?: string }, string, void>
  const iter = fn(input)
  const yields: Array<{ progress: number; total?: number; message?: string }> = []
  let next = await iter.next()
  while (!next.done) {
    yields.push(next.value)
    next = await iter.next()
  }
  return { yields, result: next.value }
}
