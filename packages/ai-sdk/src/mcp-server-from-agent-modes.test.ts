import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Agent } from './agent.js'
import { AiRegistry } from './registry.js'
import { toolDefinition } from './tool.js'
import { mcpServerFromAgent } from './mcp/server-from-agent.js'
import type {
  AiMessage, ProviderAdapter, ProviderRequestOptions, ProviderResponse, StreamChunk,
} from './types.js'

// ─── Scripted adapter (copy of handoff.test.ts pattern) ───

type ScriptStep =
  | { kind: 'text'; text: string }
  | { kind: 'toolCalls'; calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }

function scriptedAdapter(name: string, steps: ScriptStep[]) {
  const calls = { count: 0, lastOptions: undefined as ProviderRequestOptions | undefined }
  const adapter: ProviderAdapter = {
    async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
      const step = steps[calls.count]
      calls.count++
      calls.lastOptions = opts
      if (!step) throw new Error(`[${name}] script exhausted at call ${calls.count}`)
      if (step.kind === 'text') {
        return {
          message: { role: 'assistant', content: step.text },
          usage:   { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'stop',
        }
      }
      return {
        message: { role: 'assistant', content: '', toolCalls: step.calls },
        usage:   { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        finishReason: 'tool_calls',
      }
    },
    async *stream(_opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      yield { type: 'finish', finishReason: 'stop' }
    },
  }
  return { factory: { name, create: () => adapter }, calls }
}

void ([] as AiMessage[])  // import kept for future capture utilities

// ─── Loopback ─────────────────────────────────────────────

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

function textFromResult(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  return (r.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

// ─── Fixture agents ───────────────────────────────────────

const echoTool = toolDefinition({
  name:        'echo',
  description: 'Echo input back',
  inputSchema: z.object({ msg: z.string() }),
}).server(async ({ msg }) => `echo: ${msg}`)

class FakeBackedAgent extends Agent {
  instructions() { return 'Reply with whatever the script says.' }
  override model() { return 'fake/m' }
  tools() { return [echoTool] }
}

class FakeBackedAgentNoTools extends Agent {
  instructions() { return 'No tools.' }
  override model() { return 'fake/m' }
}

// ─── Agent mode ───────────────────────────────────────────

describe('mcpServerFromAgent — agent mode', () => {
  beforeEach(() => AiRegistry.reset())

  it('exposes a single prompt-tool that runs the whole agent', async () => {
    const adapter = scriptedAdapter('fake', [{ kind: 'text', text: 'hello from the agent' }])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('fake/m')

    const server = await mcpServerFromAgent(FakeBackedAgent, { expose: 'agent' })
    const { client, cleanup } = await connectClient(server)
    try {
      const list = await client.listTools()
      assert.strictEqual(list.tools.length, 1)
      assert.strictEqual(list.tools[0]!.name, 'FakeBackedAgent')

      const result = await client.callTool({ name: 'FakeBackedAgent', arguments: { prompt: 'hi' } })
      assert.strictEqual(textFromResult(result), 'hello from the agent')
    } finally { await cleanup() }
  })

  it('agentToolName overrides the default tool name', async () => {
    const adapter = scriptedAdapter('fake', [{ kind: 'text', text: 'ok' }])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('fake/m')

    const server = await mcpServerFromAgent(FakeBackedAgent, { expose: 'agent', agentToolName: 'ask_assistant' })
    const { client, cleanup } = await connectClient(server)
    try {
      const list = await client.listTools()
      assert.strictEqual(list.tools[0]!.name, 'ask_assistant')
    } finally { await cleanup() }
  })

  it('reports a clear error when prompt is missing', async () => {
    const adapter = scriptedAdapter('fake', [])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('fake/m')

    const server = await mcpServerFromAgent(FakeBackedAgent, { expose: 'agent' })
    const { client, cleanup } = await connectClient(server)
    try {
      // The SDK either throws an MCP error or surfaces the validation
      // failure as the call result — both are acceptable end-states; the
      // agent client side won't run a model call without a prompt either way.
      let surfaced = ''
      try {
        const result = await client.callTool({ name: 'FakeBackedAgent', arguments: {} })
        surfaced = textFromResult(result) + ' ' + JSON.stringify(result)
      } catch (err) {
        surfaced = err instanceof Error ? err.message : String(err)
      }
      assert.match(surfaced, /Invalid arguments|prompt|required/i)
    } finally { await cleanup() }
  })

  it('works with an agent that has no tools()', async () => {
    const adapter = scriptedAdapter('fake', [{ kind: 'text', text: 'no-tools agent ran' }])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('fake/m')

    const server = await mcpServerFromAgent(FakeBackedAgentNoTools, { expose: 'agent' })
    const { client, cleanup } = await connectClient(server)
    try {
      const result = await client.callTool({ name: 'FakeBackedAgentNoTools', arguments: { prompt: 'hi' } })
      assert.strictEqual(textFromResult(result), 'no-tools agent ran')
    } finally { await cleanup() }
  })
})

// ─── Both mode ────────────────────────────────────────────

describe('mcpServerFromAgent — both mode', () => {
  beforeEach(() => AiRegistry.reset())

  it('exposes individual tools AND the agent prompt-tool', async () => {
    const adapter = scriptedAdapter('fake', [{ kind: 'text', text: 'agent says hi' }])
    AiRegistry.register(adapter.factory)
    AiRegistry.setDefault('fake/m')

    const server = await mcpServerFromAgent(FakeBackedAgent, { expose: 'both' })
    const { client, cleanup } = await connectClient(server)
    try {
      const list = await client.listTools()
      const names = list.tools.map(t => t.name).sort()
      assert.deepStrictEqual(names, ['FakeBackedAgent', 'echo'])

      // Individual tool
      const echoResult = await client.callTool({ name: 'echo', arguments: { msg: 'hello' } })
      assert.strictEqual(textFromResult(echoResult), 'echo: hello')

      // Agent prompt-tool
      const agentResult = await client.callTool({ name: 'FakeBackedAgent', arguments: { prompt: 'q?' } })
      assert.strictEqual(textFromResult(agentResult), 'agent says hi')
    } finally { await cleanup() }
  })
})
