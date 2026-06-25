import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { AiRegistry } from './registry.js'
import type { ProviderFactory, ProviderAdapter, ProviderRequestOptions, ProviderResponse, StreamChunk } from './types.js'

// ─── Shared Mock Provider ─────────────────────────────────

function createMockAdapter(responseText = 'mock response'): ProviderAdapter {
  return {
    async generate(_opts: ProviderRequestOptions): Promise<ProviderResponse> {
      return {
        message: { role: 'assistant', content: responseText },
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop',
      }
    },
    async *stream(_opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', text: responseText }
      yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
    },
  }
}

const mockFactory: ProviderFactory = {
  name: 'mock',
  create: () => createMockAdapter(),
}

// ─── AiRegistry ───────────────────────────────────────────

describe('AiRegistry', () => {
  beforeEach(() => AiRegistry.reset())

  it('registers and retrieves a provider factory', () => {
    AiRegistry.register(mockFactory)
    assert.strictEqual(AiRegistry.getFactory('mock'), mockFactory)
  })

  it('throws for unknown provider', () => {
    assert.throws(
      () => AiRegistry.getFactory('unknown'),
      /Unknown AI provider "unknown"/,
    )
  })

  it('resolves provider/model string', () => {
    AiRegistry.register(mockFactory)
    const adapter = AiRegistry.resolve('mock/test-model')
    assert.ok(adapter)
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })

  it('parseModelString splits correctly', () => {
    const [provider, model] = AiRegistry.parseModelString('anthropic/claude-sonnet-4-5')
    assert.strictEqual(provider, 'anthropic')
    assert.strictEqual(model, 'claude-sonnet-4-5')
  })

  it('parseModelString throws on invalid format', () => {
    assert.throws(
      () => AiRegistry.parseModelString('no-slash'),
      /Invalid model string/,
    )
  })

  it('setDefault / getDefault', () => {
    AiRegistry.setDefault('mock/default-model')
    assert.strictEqual(AiRegistry.getDefault(), 'mock/default-model')
  })

  it('getDefault throws when not set', () => {
    assert.throws(
      () => AiRegistry.getDefault(),
      /No default model set/,
    )
  })

  it('reset clears everything', () => {
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test')
    AiRegistry.reset()
    assert.throws(() => AiRegistry.getFactory('mock'))
    assert.throws(() => AiRegistry.getDefault())
  })
})

// ─── Provider Constructors ────────────────────────────────

import { AnthropicProvider } from './providers/anthropic.js'
import { OpenAIProvider } from './providers/openai.js'
import { GoogleProvider } from './providers/google.js'
import { OllamaProvider } from './providers/ollama.js'

describe('AnthropicProvider', () => {
  it('has name "anthropic"', () => {
    const p = new AnthropicProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'anthropic')
  })
  it('creates an adapter', () => {
    const adapter = new AnthropicProvider({ apiKey: 'test-key' }).create('claude-sonnet-4-5')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('Anthropic cache_control markers', () => {
  it('passes through string system unchanged when caching is disabled', async () => {
    const { applyCacheToSystem } = await import('./providers/anthropic.js')
    assert.equal(applyCacheToSystem('You are helpful', false), 'You are helpful')
  })

  it('converts string system to a text block with cache_control when enabled', async () => {
    const { applyCacheToSystem } = await import('./providers/anthropic.js')
    const result = applyCacheToSystem('You are helpful', true)
    assert.deepStrictEqual(result, [
      { type: 'text', text: 'You are helpful', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('returns undefined for absent system regardless of flag', async () => {
    const { applyCacheToSystem } = await import('./providers/anthropic.js')
    assert.equal(applyCacheToSystem(undefined, true), undefined)
    assert.equal(applyCacheToSystem(undefined, false), undefined)
  })

  it('marks the last tool with cache_control when enabled', async () => {
    const { applyCacheToTools } = await import('./providers/anthropic.js')
    const tools = [
      { name: 'a', description: 'A', input_schema: {} },
      { name: 'b', description: 'B', input_schema: {} },
    ]
    const result = applyCacheToTools(tools, true) as Array<{ name: string; cache_control?: unknown }>
    assert.equal(result[0]!.cache_control, undefined)
    assert.deepStrictEqual(result[1]!.cache_control, { type: 'ephemeral' })
  })

  it('passes tools through unchanged when caching is disabled', async () => {
    const { applyCacheToTools } = await import('./providers/anthropic.js')
    const tools = [{ name: 'a', description: 'A', input_schema: {} }]
    assert.equal(applyCacheToTools(tools, false), tools)
  })

  it('handles empty tools list without crashing', async () => {
    const { applyCacheToTools } = await import('./providers/anthropic.js')
    assert.deepStrictEqual(applyCacheToTools([], true), [])
  })

  it('marks the Nth message — string content gets converted to text block', async () => {
    const { applyCacheToMessages } = await import('./providers/anthropic.js')
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]
    const result = applyCacheToMessages(messages, 2) as Array<{ role: string; content: unknown }>
    // First message untouched
    assert.equal(result[0]!.content, 'first')
    // Second message — content converted to array with cache_control on last block
    assert.deepStrictEqual(result[1]!.content, [
      { type: 'text', text: 'second', cache_control: { type: 'ephemeral' } },
    ])
    // Third untouched
    assert.equal(result[2]!.content, 'third')
  })

  it('marks the Nth message — array content gets cache_control on last block', async () => {
    const { applyCacheToMessages } = await import('./providers/anthropic.js')
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
    ]
    const result = applyCacheToMessages(messages, 1) as Array<{ content: Array<{ type: string; text: string; cache_control?: unknown }> }>
    assert.equal(result[0]!.content[0]!.cache_control, undefined)
    assert.deepStrictEqual(result[0]!.content[1]!.cache_control, { type: 'ephemeral' })
  })

  it('clamps message count to last index if it exceeds the message list', async () => {
    const { applyCacheToMessages } = await import('./providers/anthropic.js')
    const messages = [{ role: 'user', content: 'only' }]
    const result = applyCacheToMessages(messages, 99) as Array<{ content: unknown }>
    assert.deepStrictEqual(result[0]!.content, [
      { type: 'text', text: 'only', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('passes messages unchanged when count is zero or undefined', async () => {
    const { applyCacheToMessages } = await import('./providers/anthropic.js')
    const messages = [{ role: 'user', content: 'x' }]
    assert.equal(applyCacheToMessages(messages, 0), messages)
    assert.equal(applyCacheToMessages(messages, undefined), messages)
  })
})

describe('OpenAI prompt_cache_key', () => {
  const messages = [
    { role: 'system', content: 'You are helpful' },
    { role: 'user',   content: 'hello' },
    { role: 'assistant', content: 'hi' },
    { role: 'user',   content: 'second' },
  ]
  const tools = [
    { type: 'function', function: { name: 'a', description: 'A', parameters: {} } },
    { type: 'function', function: { name: 'b', description: 'B', parameters: {} } },
  ]

  it('returns undefined when no cache markers are set', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    assert.equal(buildPromptCacheKey(messages, tools, undefined), undefined)
    assert.equal(buildPromptCacheKey(messages, tools, {}), undefined)
  })

  it('returns a stable key for identical inputs', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    const a = buildPromptCacheKey(messages, tools, { instructions: true, tools: true })
    const b = buildPromptCacheKey(messages, tools, { instructions: true, tools: true })
    assert.ok(a)
    assert.equal(a, b)
  })

  it('changes when system content changes (instructions marked)', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    const a = buildPromptCacheKey(messages, tools, { instructions: true })
    const b = buildPromptCacheKey(
      [{ role: 'system', content: 'Different system' }, ...messages.slice(1)],
      tools,
      { instructions: true },
    )
    assert.notEqual(a, b)
  })

  it('does NOT change when only an unmarked region changes', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    // Mark only `instructions`. Tool list and conversation messages should
    // not affect the key — they're outside the cached prefix.
    const a = buildPromptCacheKey(messages, tools, { instructions: true })
    const differentTools = [{ type: 'function', function: { name: 'z', description: 'Z', parameters: {} } }]
    const b = buildPromptCacheKey(messages, differentTools, { instructions: true })
    assert.equal(a, b)
  })

  it('changes when tools change (tools marked)', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    const a = buildPromptCacheKey(messages, tools, { tools: true })
    const b = buildPromptCacheKey(messages, [tools[0]!], { tools: true })
    assert.notEqual(a, b)
  })

  it('hashes only the first N non-system messages when messages: N is set', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    // Mark `messages: 2` — only the first 2 user/assistant messages count.
    // Changing the 3rd should NOT change the key.
    const base = buildPromptCacheKey(messages, tools, { messages: 2 })
    const extra = buildPromptCacheKey(
      [...messages, { role: 'user', content: 'third user msg' }],
      tools,
      { messages: 2 },
    )
    assert.equal(base, extra)

    // But changing the 1st conversation message SHOULD change the key.
    const changed = buildPromptCacheKey(
      [messages[0]!, { role: 'user', content: 'changed' }, ...messages.slice(2)],
      tools,
      { messages: 2 },
    )
    assert.notEqual(base, changed)
  })

  it('returns undefined when markers are set but the corresponding regions are empty', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    // No system message, no tools, no messages — instructions+tools markers should produce nothing.
    assert.equal(buildPromptCacheKey([], undefined, { instructions: true, tools: true }), undefined)
    // messages: 5 but only a system message exists → no non-system messages to hash → undefined
    assert.equal(buildPromptCacheKey([{ role: 'system', content: 's' }], undefined, { messages: 5 }), undefined)
  })

  it('produces a hex-formatted key', async () => {
    const { buildPromptCacheKey } = await import('./providers/openai.js')
    const key = buildPromptCacheKey(messages, tools, { instructions: true })
    assert.ok(key)
    assert.match(key!, /^[0-9a-f]+$/)
  })
})

describe('OpenAIProvider', () => {
  it('has name "openai"', () => {
    const p = new OpenAIProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'openai')
  })
  it('creates an adapter', () => {
    const adapter = new OpenAIProvider({ apiKey: 'test-key' }).create('gpt-4o')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('GoogleProvider', () => {
  it('has name "google"', () => {
    const p = new GoogleProvider({ apiKey: 'test-key' })
    assert.strictEqual(p.name, 'google')
  })
  it('creates an adapter', () => {
    const adapter = new GoogleProvider({ apiKey: 'test-key' }).create('gemini-2.5-pro')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
})

describe('OllamaProvider', () => {
  it('has name "ollama"', () => {
    const p = new OllamaProvider()
    assert.strictEqual(p.name, 'ollama')
  })
  it('creates an adapter with default baseUrl', () => {
    const adapter = new OllamaProvider().create('llama3')
    assert.ok(typeof adapter.generate === 'function')
    assert.ok(typeof adapter.stream === 'function')
  })
  it('accepts custom baseUrl', () => {
    const adapter = new OllamaProvider({ baseUrl: 'http://myserver:11434/v1' }).create('llama3')
    assert.ok(adapter)
  })
})

// ─── Tool System ──────────────────────────────────────────

import { toolDefinition } from './tool.js'
import { z } from 'zod'

describe('toolDefinition', () => {
  it('creates a server tool', () => {
    const tool = toolDefinition({
      name: 'get_weather',
      description: 'Get weather for a location',
      inputSchema: z.object({ location: z.string() }),
    }).server(async ({ location }) => ({ temp: 72 }))

    assert.strictEqual(tool.definition.name, 'get_weather')
    assert.ok(typeof tool.execute === 'function')
  })

  it('creates a client tool when .server() is not called', () => {
    const tool = toolDefinition({
      name: 'apply_theme',
      description: 'Apply a UI theme',
      inputSchema: z.object({ theme: z.string() }),
    })

    // No .server() ⇒ no execute ⇒ tool is a client tool
    assert.strictEqual(tool.execute, undefined)
    assert.strictEqual(tool.definition.name, 'apply_theme')
  })

  it('supports needsApproval', () => {
    const builder = toolDefinition({
      name: 'delete_file',
      description: 'Delete a file',
      inputSchema: z.object({ path: z.string() }),
      needsApproval: true,
    })
    assert.strictEqual(builder.options.needsApproval, true)
  })

  it('supports lazy flag', () => {
    const builder = toolDefinition({
      name: 'rare_tool',
      description: 'Rarely used',
      inputSchema: z.object({ q: z.string() }),
      lazy: true,
    })
    assert.strictEqual(builder.options.lazy, true)
  })

  it('converts to JSON Schema', () => {
    const builder = toolDefinition({
      name: 'search',
      description: 'Search items',
      inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    })
    const schema = builder.toSchema()
    assert.strictEqual(schema.name, 'search')
    assert.strictEqual(schema.description, 'Search items')
    assert.strictEqual((schema.parameters as any).type, 'object')
    assert.ok((schema.parameters as any).properties.query)
    assert.ok((schema.parameters as any).properties.limit)
    assert.deepStrictEqual((schema.parameters as any).required, ['query'])
  })

  it('handles nested objects in schema', () => {
    const builder = toolDefinition({
      name: 'complex',
      description: 'Complex tool',
      inputSchema: z.object({
        name: z.string(),
        tags: z.array(z.string()),
        meta: z.object({ key: z.string() }),
      }),
    })
    const schema = builder.toSchema()
    const props = (schema.parameters as any).properties
    assert.strictEqual(props.tags.type, 'array')
    assert.strictEqual(props.tags.items.type, 'string')
    assert.strictEqual(props.meta.type, 'object')
  })

  it('executes server tool', async () => {
    const tool = toolDefinition({
      name: 'add',
      description: 'Add numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    }).server(async ({ a, b }) => a + b)

    const result = await tool.execute!({ a: 2, b: 3 })
    assert.strictEqual(result, 5)
  })
})

// ─── Agent ────────────────────────────────────────────────

import { Agent, agent, stepCountIs, hasToolCall } from './agent.js'
import type { AgentResponse } from './types.js'

describe('Agent', () => {
  beforeEach(() => {
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test-model')
  })

  it('creates agent with instructions', () => {
    class MyAgent extends Agent {
      instructions() { return 'You are a helpful assistant.' }
    }
    const a = new MyAgent()
    assert.strictEqual(a.instructions(), 'You are a helpful assistant.')
  })

  it('prompt() returns AgentResponse', async () => {
    class MyAgent extends Agent {
      instructions() { return 'Test agent' }
    }
    const response = await new MyAgent().prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
    assert.strictEqual(response.steps.length, 1)
    assert.ok(response.usage)
    assert.strictEqual(response.usage.totalTokens, 15)
  })

  it('anonymous agent() helper works', async () => {
    const response = await agent('You are helpful.').prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
  })

  it('supports model override', () => {
    class MyAgent extends Agent {
      instructions() { return 'Test' }
      model() { return 'mock/custom-model' }
    }
    assert.strictEqual(new MyAgent().model(), 'mock/custom-model')
  })

  it('supports failover array', () => {
    class MyAgent extends Agent {
      instructions() { return 'Test' }
      failover() { return ['openai/gpt-4o', 'google/gemini-2.5-pro'] }
    }
    assert.deepStrictEqual(new MyAgent().failover(), ['openai/gpt-4o', 'google/gemini-2.5-pro'])
  })

  it('executes tools in the loop', async () => {
    let toolCallCount = 0
    const calls: string[] = []

    // Mock a provider that calls a tool on first request, then stops
    const toolAdapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        toolCallCount++
        if (toolCallCount === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'tc1', name: 'greet', arguments: { name: 'World' } }],
            },
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'tool_calls',
          }
        }
        return {
          message: { role: 'assistant', content: 'Done! I greeted World.' },
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }

    AiRegistry.reset()
    AiRegistry.register({ name: 'toolmock', create: () => toolAdapter })
    AiRegistry.setDefault('toolmock/v1')

    const greetTool = toolDefinition({
      name: 'greet',
      description: 'Greet someone',
      inputSchema: z.object({ name: z.string() }),
    }).server(async ({ name }) => {
      calls.push(name)
      return `Hello, ${name}!`
    })

    const response = await agent({
      instructions: 'You greet people.',
      tools: [greetTool],
    }).prompt('Greet the world')

    assert.strictEqual(response.text, 'Done! I greeted World.')
    assert.strictEqual(response.steps.length, 2)
    assert.deepStrictEqual(calls, ['World'])
    assert.strictEqual(response.usage.totalTokens, 45)
  })

  it('yielded pauseForClientTools chunk bubbles nested client tool calls to parent pending list', async () => {
    // Phase 2 of subagent-client-tools-plan (control-chunk revision). A
    // server tool's async-generator execute that yields a pause control
    // chunk must cause the enclosing agent loop to:
    //   1. Append chunk.toolCalls to pendingClientToolCalls
    //   2. Set finishReason = 'client_tool_calls'
    //   3. NOT push a tool_result or tool message for the yielding tool
    //      call — the run_agent call stays orphaned until its caller
    //      resolves it on continuation.
    //   4. Break the loop cleanly.
    //
    // Yield-based instead of throw-based so the pause is a first-class
    // control signal in the same protocol as `tool-update`, observable by
    // middleware's `runOnChunk`, without exception-abuse.
    const { pauseForClientTools } = await import('./tool.js')

    const toolAdapter: import('./types.js').ProviderAdapter = {
      async generate() {
        return {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_run_agent_1', name: 'fake_run_agent', arguments: {} }],
          },
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
          finishReason: 'tool_calls',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }

    AiRegistry.reset()
    AiRegistry.register({ name: 'pausemock', create: () => toolAdapter })
    AiRegistry.setDefault('pausemock/v1')

    const nestedClientCall = {
      id: 'call_nested_update_form_state_1',
      name: 'update_form_state',
      arguments: { field: 'title', operations: [{ type: 'set_value', value: 'hi' }] },
    }

    const fakeRunAgentTool = toolDefinition({
      name: 'fake_run_agent',
      description: 'Simulates run_agent pausing on a nested client tool',
      inputSchema: z.object({}),
    }).server(async function* () {
      yield pauseForClientTools([nestedClientCall], 'sub-run-id-42')
      // Unreachable: the agent loop halts iteration after the pause chunk.
      return 'unreachable'
    })

    const response = await agent({
      instructions: 'T',
      tools: [fakeRunAgentTool],
    }).prompt('go', { toolCallStreamingMode: 'stop-on-client-tool' })

    assert.strictEqual(response.finishReason, 'client_tool_calls')
    assert.ok(response.pendingClientToolCalls, 'pendingClientToolCalls should be populated')
    assert.strictEqual(response.pendingClientToolCalls!.length, 1)
    assert.strictEqual(response.pendingClientToolCalls![0]!.id, 'call_nested_update_form_state_1')
    assert.strictEqual(response.pendingClientToolCalls![0]!.name, 'update_form_state')

    // The orphan assistant message is present, but there is NO tool-role
    // message for call_run_agent_1 — it's awaiting resolution.
    const lastStep = response.steps[response.steps.length - 1]!
    const toolResultForRunAgent = lastStep.toolResults.find(r => r.toolCallId === 'call_run_agent_1')
    assert.strictEqual(
      toolResultForRunAgent,
      undefined,
      'no tool_result should be recorded for the yielding tool call',
    )
  })

  it('passes ToolCallContext with toolCallId to server tool execute', async () => {
    // Regression test for the subagent-client-tools-plan Phase 0 change:
    // a server tool's execute must receive the current toolCall.id as a
    // second `ctx` argument, so nested runners (run_agent) can correlate
    // their sub-run state with the parent tool call that invoked them.
    const observed: Array<{ input: unknown; ctx: unknown }> = []

    const toolAdapter: import('./types.js').ProviderAdapter = {
      async generate() {
        if (observed.length === 0) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'tc-abc-123', name: 'capture_ctx', arguments: { marker: 'hi' } }],
            },
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            finishReason: 'tool_calls',
          }
        }
        return {
          message: { role: 'assistant', content: 'done' },
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }

    AiRegistry.reset()
    AiRegistry.register({ name: 'ctxmock', create: () => toolAdapter })
    AiRegistry.setDefault('ctxmock/v1')

    const captureCtxTool = toolDefinition({
      name: 'capture_ctx',
      description: 'Capture the ToolCallContext for assertion',
      inputSchema: z.object({ marker: z.string() }),
    }).server(async (input, ctx) => {
      observed.push({ input, ctx })
      return 'ok'
    })

    await agent({ instructions: 'T', tools: [captureCtxTool] }).prompt('go')

    assert.strictEqual(observed.length, 1)
    assert.deepStrictEqual(observed[0]!.input, { marker: 'hi' })
    assert.deepStrictEqual(observed[0]!.ctx, { toolCallId: 'tc-abc-123' })
  })

  it('stream() yields chunks and resolves response', async () => {
    const { stream, response } = agent('Test.').stream('Hello')
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    assert.ok(chunks.length > 0)
    assert.strictEqual(chunks[0]!.type, 'text-delta')

    const final = await response
    assert.strictEqual(final.text, 'mock response')
  })
})

// ─── Agent.asTool (subagents) ─────────────────────────────

describe('Agent.asTool', () => {
  beforeEach(() => {
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test-model')
  })

  it('zero-config: defaults schema to { prompt: string } and modelOutput to response.text', async () => {
    class Researcher extends Agent {
      instructions() { return 'You research things.' }
    }
    const tool = new Researcher().asTool({
      name: 'research',
      description: 'Research a topic in depth.',
    })

    assert.strictEqual(tool.definition.name, 'research')
    assert.strictEqual(tool.definition.description, 'Research a topic in depth.')

    const result = await tool.execute!({ prompt: 'tell me about cats' }) as AgentResponse
    assert.strictEqual(result.text, 'mock response')

    const summarized = await tool.toModelOutput!(result)
    assert.strictEqual(summarized, 'mock response')
  })

  it('default schema requires { prompt: string }', () => {
    class A extends Agent { instructions() { return '' } }
    const tool = new A().asTool({ name: 'sub', description: 'sub' })
    const schema = tool.definition.inputSchema as z.ZodType
    assert.deepStrictEqual(schema.parse({ prompt: 'hi' }), { prompt: 'hi' })
    assert.throws(() => schema.parse({}), /prompt/i)
  })

  it('custom inputSchema + prompt mapper drives the inner agent', async () => {
    let captured = ''
    class Captured extends Agent {
      instructions() { return '' }
      override async prompt(input: string) {
        captured = input
        return super.prompt(input)
      }
    }
    const tool = new Captured().asTool({
      name:        'research',
      description: 'Research a topic.',
      inputSchema: z.object({ topic: z.string(), depth: z.enum(['quick', 'deep']) }),
      prompt:      ({ topic, depth }) => `Research ${topic} (${depth}).`,
    })

    await tool.execute!({ topic: 'birds', depth: 'deep' })
    assert.strictEqual(captured, 'Research birds (deep).')
  })

  it('custom modelOutput summarizes the response for the parent model', async () => {
    class A extends Agent { instructions() { return '' } }
    const tool = new A().asTool({
      name:        'sub',
      description: 'sub',
      modelOutput: (r) => `[summary: ${r.text.length} chars, ${r.steps.length} step(s)]`,
    })

    const result = await tool.execute!({ prompt: 'hi' }) as AgentResponse
    const summarized = await tool.toModelOutput!(result)
    assert.strictEqual(summarized, '[summary: 13 chars, 1 step(s)]')
  })

  it('parent agent invokes the subagent tool through the loop', async () => {
    let parentCalls = 0
    const parentAdapter: ProviderAdapter = {
      async generate() {
        parentCalls++
        if (parentCalls === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'tc1', name: 'research', arguments: { prompt: 'cats' } }],
            },
            usage:        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: 'tool_calls',
          }
        }
        return {
          message:      { role: 'assistant', content: 'all done' },
          usage:        { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }

    AiRegistry.reset()
    AiRegistry.register({ name: 'parent', create: () => parentAdapter })
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test-model')

    class Researcher extends Agent {
      instructions() { return 'subagent' }
      override model() { return 'mock/test-model' }
    }
    const research = new Researcher().asTool({
      name:        'research',
      description: 'Research things',
    })

    class Planner extends Agent {
      instructions() { return 'planner' }
      override model() { return 'parent/v1' }
      tools() { return [research] }
    }

    const response = await new Planner().prompt('plan a trip')
    assert.strictEqual(response.text, 'all done')
    assert.strictEqual(response.steps[0]!.toolResults[0]!.toolCallId, 'tc1')
    const innerResult = response.steps[0]!.toolResults[0]!.result as { text: string }
    assert.strictEqual(innerResult.text, 'mock response')
  })
})

describe('stopWhen combinators', () => {
  it('stepCountIs stops at N steps', () => {
    const stop = stepCountIs(3)
    const fakeStep = { message: { role: 'assistant' as const, content: '' }, toolCalls: [], toolResults: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' as const }
    assert.strictEqual(stop({ steps: [fakeStep, fakeStep, fakeStep], iteration: 2, lastMessage: fakeStep.message }), true)
    assert.strictEqual(stop({ steps: [fakeStep], iteration: 0, lastMessage: fakeStep.message }), false)
  })

  it('hasToolCall stops on specific tool', () => {
    const stop = hasToolCall('done')
    const step = {
      message: { role: 'assistant' as const, content: '' },
      toolCalls: [{ id: '1', name: 'done', arguments: {} }],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'tool_calls' as const,
    }
    assert.strictEqual(stop({ steps: [step], iteration: 0, lastMessage: step.message }), true)
  })

  it('hasToolCall returns false when tool not called', () => {
    const stop = hasToolCall('done')
    const step = {
      message: { role: 'assistant' as const, content: '' },
      toolCalls: [{ id: '1', name: 'search', arguments: {} }],
      toolResults: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'tool_calls' as const,
    }
    assert.strictEqual(stop({ steps: [step], iteration: 0, lastMessage: step.message }), false)
  })
})

// ─── Middleware ────────────────────────────────────────────

import {
  runOnConfig,
  runOnChunk,
  runOnBeforeToolCall,
  runOnAfterToolCall,
  runOnUsage,
  runSequential,
  runOnAbort,
  runOnError,
} from './middleware.js'
import type { AiMiddleware, MiddlewareContext, MiddlewareConfigResult, TokenUsage } from './types.js'

describe('Middleware', () => {
  const baseCtx: MiddlewareContext = {
    requestId: 'test',
    iteration: 0,
    chunkIndex: 0,
    messages: [],
    model: 'mock/test',
    provider: 'mock',
    toolNames: [],
    abort() {},
  }

  it('onConfig pipes transforms', () => {
    const mw1: AiMiddleware = {
      name: 'mw1',
      onConfig(_ctx, config) {
        return { ...config, temperature: 0.5 }
      },
    }
    const mw2: AiMiddleware = {
      name: 'mw2',
      onConfig(_ctx, config) {
        return { ...config, maxTokens: 1000 }
      },
    }
    const result = runOnConfig([mw1, mw2], baseCtx, {}, 'init')
    assert.strictEqual(result.temperature, 0.5)
    assert.strictEqual(result.maxTokens, 1000)
  })

  it('onChunk transforms chunks', () => {
    const mw: AiMiddleware = {
      name: 'upper',
      onChunk(_ctx, chunk) {
        if (chunk.type === 'text-delta' && chunk.text) {
          return { ...chunk, text: chunk.text.toUpperCase() }
        }
        return chunk
      },
    }
    const result = runOnChunk([mw], baseCtx, { type: 'text-delta', text: 'hello' })
    assert.strictEqual(result?.text, 'HELLO')
  })

  it('onChunk drops chunks when returning null', () => {
    const mw: AiMiddleware = {
      name: 'dropper',
      onChunk() { return null },
    }
    const result = runOnChunk([mw], baseCtx, { type: 'text-delta', text: 'hello' })
    assert.strictEqual(result, null)
  })

  it('onBeforeToolCall can skip with cached result', async () => {
    const mw: AiMiddleware = {
      name: 'cache',
      async onBeforeToolCall(_ctx, toolName) {
        if (toolName === 'weather') return { type: 'skip', result: { temp: 72 } }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'weather', {})
    assert.deepStrictEqual(result, { type: 'skip', result: { temp: 72 } })
  })

  it('onBeforeToolCall can transform args', async () => {
    const mw: AiMiddleware = {
      name: 'transform',
      async onBeforeToolCall(_ctx, _name, args) {
        return { type: 'transformArgs', args: { ...args, extra: true } }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'search', { q: 'test' })
    assert.deepStrictEqual(result, { type: 'transformArgs', args: { q: 'test', extra: true } })
  })

  it('onBeforeToolCall can abort', async () => {
    const mw: AiMiddleware = {
      name: 'guard',
      async onBeforeToolCall(_ctx, toolName) {
        if (toolName === 'dangerous') return { type: 'abort', reason: 'Blocked' }
      },
    }
    const result = await runOnBeforeToolCall([mw], baseCtx, 'dangerous', {})
    assert.deepStrictEqual(result, { type: 'abort', reason: 'Blocked' })
  })

  it('runOnAfterToolCall invokes every middleware sequentially with name/args/result', async () => {
    const seen: Array<[string, string, unknown, unknown]> = []
    const mk = (label: string): AiMiddleware => ({
      name: label,
      async onAfterToolCall(_ctx, toolName, args, result) {
        seen.push([label, toolName, args, result])
      },
    })
    await runOnAfterToolCall([mk('a'), mk('b')], baseCtx, 'search', { q: 'x' }, { hits: 3 })
    assert.deepStrictEqual(seen, [
      ['a', 'search', { q: 'x' }, { hits: 3 }],
      ['b', 'search', { q: 'x' }, { hits: 3 }],
    ])
  })

  it('runOnAfterToolCall skips middlewares that did not define the hook', async () => {
    let called = 0
    const noop: AiMiddleware = { name: 'noop' }
    const counter: AiMiddleware = { name: 'counter', async onAfterToolCall() { called++ } }
    await runOnAfterToolCall([noop, counter], baseCtx, 't', {}, null)
    assert.strictEqual(called, 1)
  })

  it('runOnUsage forwards the same TokenUsage to every hook', async () => {
    const seen: TokenUsage[] = []
    const usage: TokenUsage = { promptTokens: 12, completionTokens: 8, totalTokens: 20 }
    const recorder = (label: string): AiMiddleware => ({
      name: label,
      async onUsage(_ctx, u) { seen.push(u) },
    })
    await runOnUsage([recorder('a'), recorder('b')], baseCtx, usage)
    assert.deepStrictEqual(seen, [usage, usage])
  })

  it('runSequential dispatches the right hook by name and preserves order', async () => {
    const order: string[] = []
    const mw: AiMiddleware = {
      name: 'multi',
      async onStart() { order.push('start') },
      async onIteration() { order.push('iteration') },
      async onToolPhaseComplete() { order.push('tool-phase') },
      async onFinish() { order.push('finish') },
    }
    await runSequential([mw], 'onStart', baseCtx)
    await runSequential([mw], 'onIteration', baseCtx)
    await runSequential([mw], 'onToolPhaseComplete', baseCtx)
    await runSequential([mw], 'onFinish', baseCtx)
    assert.deepStrictEqual(order, ['start', 'iteration', 'tool-phase', 'finish'])
  })

  it('runSequential awaits async hooks across middlewares in declaration order', async () => {
    const order: string[] = []
    const slow: AiMiddleware = {
      name: 'slow',
      async onIteration() {
        await new Promise(r => setTimeout(r, 5))
        order.push('slow')
      },
    }
    const fast: AiMiddleware = {
      name: 'fast',
      async onIteration() { order.push('fast') },
    }
    await runSequential([slow, fast], 'onIteration', baseCtx)
    assert.deepStrictEqual(order, ['slow', 'fast'])
  })

  it('runOnAbort forwards the reason to every hook', async () => {
    const reasons: string[] = []
    const mk = (label: string): AiMiddleware => ({
      name: label,
      async onAbort(_ctx, reason) { reasons.push(`${label}:${reason}`) },
    })
    await runOnAbort([mk('a'), mk('b')], baseCtx, 'budget exceeded')
    assert.deepStrictEqual(reasons, ['a:budget exceeded', 'b:budget exceeded'])
  })

  it('runOnError forwards the error to every hook in order', async () => {
    const seen: unknown[] = []
    const recorder = (label: string): AiMiddleware => ({
      name: label,
      async onError(_ctx, err) { seen.push([label, err]) },
    })
    const err = new Error('boom')
    await runOnError([recorder('a'), recorder('b')], baseCtx, err)
    assert.deepStrictEqual(seen, [['a', err], ['b', err]])
  })
})

// ─── Output ───────────────────────────────────────────────

import { Output } from './output.js'

describe('Output', () => {
  it('Output.object() parses valid JSON', () => {
    const output = Output.object({ schema: z.object({ name: z.string() }) })
    assert.strictEqual(output.type, 'object')
    const result = output.parse('{"name": "test"}')
    assert.deepStrictEqual(result, { name: 'test' })
  })

  it('Output.object() strips markdown fences', () => {
    const output = Output.object({ schema: z.object({ x: z.number() }) })
    const result = output.parse('```json\n{"x": 42}\n```')
    assert.deepStrictEqual(result, { x: 42 })
  })

  it('Output.object() throws on invalid', () => {
    const output = Output.object({ schema: z.object({ name: z.string() }) })
    assert.throws(() => output.parse('{"name": 123}'))
  })

  it('Output.array() parses array', () => {
    const output = Output.array({ element: z.object({ id: z.number() }) })
    assert.strictEqual(output.type, 'array')
    const result = output.parse('[{"id": 1}, {"id": 2}]')
    assert.deepStrictEqual(result, [{ id: 1 }, { id: 2 }])
  })

  it('Output.choice() picks from options', () => {
    const output = Output.choice({ options: ['sunny', 'rainy', 'snowy'] as const })
    assert.strictEqual(output.type, 'choice')
    assert.strictEqual(output.parse('sunny'), 'sunny')
    assert.strictEqual(output.parse('  rainy  '), 'rainy')
  })

  it('Output.choice() throws on invalid option', () => {
    const output = Output.choice({ options: ['a', 'b'] as const })
    assert.throws(() => output.parse('c'))
  })

  it('toSystemPrompt() returns instruction string', () => {
    const output = Output.object({ schema: z.object({ x: z.number() }) })
    const prompt = output.toSystemPrompt()
    assert.ok(prompt.includes('JSON'))
    assert.ok(prompt.includes('object'))
  })
})

// ─── Conversation ─────────────────────────────────────────

import { MemoryConversationStore } from './conversation.js'

describe('MemoryConversationStore', () => {
  it('creates a conversation and returns an ID', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create('Test')
    assert.ok(id)
    assert.ok(typeof id === 'string')
  })

  it('appends and loads messages', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create()
    await store.append(id, [{ role: 'user', content: 'Hello' }])
    await store.append(id, [{ role: 'assistant', content: 'Hi!' }])
    const messages = await store.load(id)
    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0]!.content, 'Hello')
    assert.strictEqual(messages[1]!.content, 'Hi!')
  })

  it('lists conversations', async () => {
    const store = new MemoryConversationStore()
    await store.create('Chat 1')
    await store.create('Chat 2')
    const list = await store.list()
    assert.strictEqual(list.length, 2)
  })

  it('setTitle updates title', async () => {
    const store = new MemoryConversationStore()
    const id = await store.create('Old')
    await store.setTitle(id, 'New Title')
    const list = await store.list()
    assert.strictEqual(list.find(c => c.id === id)?.title, 'New Title')
  })

  it('throws for unknown conversation', async () => {
    const store = new MemoryConversationStore()
    await assert.rejects(() => store.load('nonexistent'), /not found/)
  })
})

// ─── ConversableAgent ─────────────────────────────────────

import { ConversableAgent, setConversationStore } from './agent.js'
import { AiFake as ConversableAiFake } from './fake.js'

describe('ConversableAgent', () => {
  let fake: ConversableAiFake

  beforeEach(() => {
    fake = ConversableAiFake.fake()
    // Each test starts without a registered store so we can assert the
    // unregistered-store error path independently.
    setConversationStore(undefined as unknown as never)
  })

  it('throws when no ConversationStore is registered', async () => {
    fake.respondWith('hi')
    const a = agent('You are helpful.').forUser('u-1')
    await assert.rejects(() => a.prompt('hello'), /No ConversationStore registered/)
  })

  it('forUser() creates a new conversation, returns its id, and persists user + assistant messages', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('Hi there.')

    const a = agent('You are helpful.').forUser('u-42')
    const response = await a.prompt('hello')

    assert.ok(response.conversationId, 'response should carry the new conversationId')
    const messages = await store.load(response.conversationId!)
    // Loop produced one assistant step → 2 messages persisted (user + assistant)
    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0]!.role, 'user')
    assert.strictEqual(messages[0]!.content, 'hello')
    assert.strictEqual(messages[1]!.role, 'assistant')
    assert.strictEqual(messages[1]!.content, 'Hi there.')

    // userId metadata flowed into store.list()
    const list = await store.list('u-42')
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0]!.id, response.conversationId)
  })

  it('continue() loads existing history and threads it into the next provider call', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    const id = await store.create('Existing')
    await store.append(id, [
      { role: 'user', content: 'first user msg' },
      { role: 'assistant', content: 'first assistant reply' },
    ])

    fake.respondWith('continued reply')
    const a = agent('sys').continue(id)
    const response = await a.prompt('second user msg')

    assert.strictEqual(response.conversationId, id)
    // The provider call must have seen the existing history before the new user msg.
    const call = fake.getCalls()[0]!
    const userTexts = call.messages.filter(m => m.role === 'user').map(m => m.content)
    const assistantTexts = call.messages.filter(m => m.role === 'assistant').map(m => m.content)
    assert.ok(userTexts.includes('first user msg'), `expected loaded user history; got ${userTexts.join(',')}`)
    assert.ok(userTexts.includes('second user msg'), 'expected new user msg')
    assert.ok(assistantTexts.includes('first assistant reply'), 'expected loaded assistant history')

    // Persistence appended only the new user msg + new assistant msg, not duplicates.
    const finalMessages = await store.load(id)
    assert.strictEqual(finalMessages.length, 4)
    assert.strictEqual(finalMessages[2]!.content, 'second user msg')
    assert.strictEqual(finalMessages[3]!.content, 'continued reply')
  })

  it('reuses the same conversationId across multiple prompts on the same instance', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('ack')

    const a = agent('sys').forUser('u-7')
    const r1 = await a.prompt('one')
    const r2 = await a.prompt('two')

    assert.strictEqual(r1.conversationId, r2.conversationId)
    const messages = await store.load(r1.conversationId!)
    assert.strictEqual(messages.length, 4) // user/assistant × 2
    assert.strictEqual(messages[0]!.content, 'one')
    assert.strictEqual(messages[2]!.content, 'two')
  })

  it('persists tool messages alongside the assistant message for tool-using turns', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)

    const greet = toolDefinition({
      name: 'greet',
      description: 'greet someone',
      inputSchema: z.object({ name: z.string() }),
    }).server(async ({ name }) => `hi ${name}`)

    fake.respondWithSequence([
      { toolCalls: [{ id: 't1', name: 'greet', arguments: { name: 'world' } }] },
      { text: 'all done' },
    ])

    const a = agent({ instructions: 'sys', tools: [greet] }).forUser('u-9')
    const response = await a.prompt('greet world')

    const messages = await store.load(response.conversationId!)
    // user → assistant{toolCalls} → tool → assistant{text}
    assert.strictEqual(messages.length, 4)
    assert.strictEqual(messages[0]!.role, 'user')
    assert.strictEqual(messages[1]!.role, 'assistant')
    assert.deepStrictEqual(messages[1]!.toolCalls, [{ id: 't1', name: 'greet', arguments: { name: 'world' } }])
    assert.strictEqual(messages[2]!.role, 'tool')
    assert.strictEqual(messages[2]!.toolCallId, 't1')
    assert.strictEqual(messages[2]!.content, 'hi world')
    assert.strictEqual(messages[3]!.role, 'assistant')
    assert.strictEqual(messages[3]!.content, 'all done')
  })

  it('streaming variant persists messages and resolves with the conversationId', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('streamed reply')

    const a = agent('sys').forUser('u-stream')
    const { stream, response } = a.stream('hi')
    for await (const _ of stream) { /* drain */ }
    const final = await response

    assert.ok(final.conversationId)
    assert.strictEqual(final.text, 'streamed reply')
    const messages = await store.load(final.conversationId!)
    assert.strictEqual(messages.length, 2)
    assert.strictEqual(messages[0]!.content, 'hi')
    assert.strictEqual(messages[1]!.content, 'streamed reply')
  })

  it('ConversableAgent can be constructed directly and threads through the same store', async () => {
    const store = new MemoryConversationStore()
    setConversationStore(store)
    fake.respondWith('direct')

    const inner = agent('sys')
    const wrap = new ConversableAgent(inner).forUser('u-direct')
    const response = await wrap.prompt('hey')
    assert.ok(response.conversationId)
    const messages = await store.load(response.conversationId!)
    assert.strictEqual(messages.length, 2)
  })
})

// ─── AI Facade ────────────────────────────────────────────

import { AI } from './facade.js'

describe('AI facade', () => {
  beforeEach(() => {
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/test')
  })

  it('AI.prompt() uses default model', async () => {
    const response = await AI.prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
  })

  it('AI.agent() creates an agent', async () => {
    const a = AI.agent('You are helpful.')
    const response = await a.prompt('Hi')
    assert.strictEqual(response.text, 'mock response')
  })

  it('AI.embed() calls the embedding adapter', async () => {
    AiRegistry.reset()
    AiRegistry.register({
      name: 'embmock',
      create: () => createMockAdapter(),
      createEmbedding: () => ({
        async embed(input: string | string[]) {
          const inputs = Array.isArray(input) ? input : [input]
          return {
            embeddings: inputs.map(() => [0.1, 0.2, 0.3]),
            usage: { promptTokens: 5, totalTokens: 5 },
          }
        },
      }),
    })
    AiRegistry.setDefault('embmock/test')

    const result = await AI.embed('hello')
    assert.strictEqual(result.embeddings.length, 1)
    assert.deepStrictEqual(result.embeddings[0], [0.1, 0.2, 0.3])
  })

  it('AI.embed() with array input', async () => {
    AiRegistry.reset()
    AiRegistry.register({
      name: 'embmock',
      create: () => createMockAdapter(),
      createEmbedding: () => ({
        async embed(input: string | string[]) {
          const inputs = Array.isArray(input) ? input : [input]
          return {
            embeddings: inputs.map((_, i) => [i * 0.1]),
            usage: { promptTokens: 10, totalTokens: 10 },
          }
        },
      }),
    })
    AiRegistry.setDefault('embmock/test')

    const result = await AI.embed(['a', 'b', 'c'])
    assert.strictEqual(result.embeddings.length, 3)
  })

  it('AI.embed() throws when provider lacks embedding support', async () => {
    AiRegistry.reset()
    AiRegistry.register({ name: 'noemb', create: () => createMockAdapter() })
    AiRegistry.setDefault('noemb/test')

    await assert.rejects(() => AI.embed('hello'), /does not support embeddings/)
  })
})

// ─── Prompt caching (A1) ─────────────────────────────────

describe('Prompt caching — agent plumbing', () => {
  it('does not set cache when agent has no cacheable() declaration', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class A extends Agent { instructions() { return 'sys' } }
    await new A().prompt('hi')
    assert.equal(captured!.cache, undefined)
  })

  it('forwards cacheable markers to the provider', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class CachedAgent extends Agent {
      instructions() { return 'sys' }
      cacheable() { return { instructions: true, tools: true, messages: 2 } }
    }
    await new CachedAgent().prompt('hi')

    assert.deepStrictEqual(captured!.cache, {
      instructions: true,
      tools:        true,
      messages:     2,
    })
  })

  it('per-call cache: false disables caching even when agent declares it', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class CachedAgent extends Agent {
      instructions() { return 'sys' }
      cacheable() { return { instructions: true } }
    }
    await new CachedAgent().prompt('hi', { cache: false })
    assert.equal(captured!.cache, undefined)
  })

  it('per-call cache config replaces the agent default for that call', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class CachedAgent extends Agent {
      instructions() { return 'sys' }
      cacheable() { return { instructions: true } }
    }
    await new CachedAgent().prompt('hi', { cache: { tools: true } })
    assert.deepStrictEqual(captured!.cache, { tools: true })
  })

  it('omits the cache field when all flags are zero/false', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class A extends Agent {
      instructions() { return '' }
      cacheable() { return { instructions: false, messages: 0 } }
    }
    await new A().prompt('hi')
    assert.equal(captured!.cache, undefined)
  })

  it('messages count is floored to a positive integer', async () => {
    AiRegistry.reset()
    let captured: import('./types.js').ProviderRequestOptions | undefined
    const adapter: import('./types.js').ProviderAdapter = {
      async generate(opts) {
        captured = opts
        return {
          message: { role: 'assistant', content: 'ok' },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }
      },
      async *stream() { yield { type: 'finish', finishReason: 'stop' } },
    }
    AiRegistry.register({ name: 'cap', create: () => adapter })
    AiRegistry.setDefault('cap/v1')

    class A extends Agent {
      instructions() { return '' }
      cacheable() { return { messages: 2.7 } }
    }
    await new A().prompt('hi')
    assert.equal(captured!.cache?.messages, 2)
  })
})

// ─── Failover ─────────────────────────────────────────────

describe('Agent failover', () => {
  it('falls back to next model on error', async () => {
    AiRegistry.reset()

    let failCount = 0
    const failAdapter: import('./types.js').ProviderAdapter = {
      async generate() { failCount++; throw new Error('Provider down') },
      async *stream() { throw new Error('Provider down') }, // eslint-disable-line require-yield
    }

    AiRegistry.register({ name: 'fail', create: () => failAdapter })
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('fail/v1')

    class FailoverAgent extends Agent {
      instructions() { return 'Test' }
      model() { return 'fail/v1' }
      failover() { return ['mock/test'] }
    }

    const response = await new FailoverAgent().prompt('Hello')
    assert.strictEqual(response.text, 'mock response')
    assert.strictEqual(failCount, 1)
  })

  it('throws when all failover models fail', async () => {
    AiRegistry.reset()

    const failAdapter: import('./types.js').ProviderAdapter = {
      async generate() { throw new Error('Down') },
      async *stream() { throw new Error('Down') }, // eslint-disable-line require-yield
    }

    AiRegistry.register({ name: 'fail1', create: () => failAdapter })
    AiRegistry.register({ name: 'fail2', create: () => failAdapter })
    AiRegistry.setDefault('fail1/v1')

    class AllFailAgent extends Agent {
      instructions() { return 'Test' }
      model() { return 'fail1/v1' }
      failover() { return ['fail2/v1'] }
    }

    await assert.rejects(() => new AllFailAgent().prompt('Hello'), /Down/)
  })
})

// ─── Media failover (B1) ──────────────────────────────────

import { ImageGenerator } from './image.js'
import { AudioGenerator } from './audio.js'
import { Transcription } from './transcription.js'

describe('Media failover', () => {
  it('ImageGenerator falls back to next provider on error', async () => {
    AiRegistry.reset()

    let failCalls = 0
    const failingImage: import('./types.js').ImageGenerationAdapter = {
      async generate() { failCalls++; throw new Error('Image provider down') },
    }
    const successImage: import('./types.js').ImageGenerationAdapter = {
      async generate(opts) { return { images: [{ base64: 'OK' }], model: opts.model ?? 'fallback' } },
    }
    AiRegistry.register({
      name: 'failimg',
      create: (m) => mockFactory.create(m),
      createImage: () => failingImage,
    })
    AiRegistry.register({
      name: 'okimg',
      create: (m) => mockFactory.create(m),
      createImage: () => successImage,
    })

    const result = await ImageGenerator.of('A donut')
      .model('failimg/v1')
      .failover('okimg/v1')
      .generate()

    assert.equal(failCalls, 1)
    assert.equal(result.images[0]!.base64, 'OK')
  })

  it('ImageGenerator surfaces last error when all fail', async () => {
    AiRegistry.reset()
    const failing: import('./types.js').ImageGenerationAdapter = {
      async generate() { throw new Error('boom') },
    }
    AiRegistry.register({ name: 'a', create: (m) => mockFactory.create(m), createImage: () => failing })
    AiRegistry.register({ name: 'b', create: (m) => mockFactory.create(m), createImage: () => failing })

    await assert.rejects(
      () => ImageGenerator.of('A donut').model('a/v1').failover('b/v1').generate(),
      /boom/,
    )
  })

  it('ImageGenerator skips a fallback that lacks the capability', async () => {
    AiRegistry.reset()

    const failingImage: import('./types.js').ImageGenerationAdapter = {
      async generate() { throw new Error('first down') },
    }
    AiRegistry.register({ name: 'failimg', create: (m) => mockFactory.create(m), createImage: () => failingImage })
    // Second provider has NO createImage — should error with "not supported", caught + skipped
    AiRegistry.register({ name: 'noimg',  create: (m) => mockFactory.create(m) })
    // Third provider works
    const okImage: import('./types.js').ImageGenerationAdapter = {
      async generate(opts) { return { images: [{ base64: 'OK' }], model: opts.model ?? 'ok' } },
    }
    AiRegistry.register({ name: 'okimg',  create: (m) => mockFactory.create(m), createImage: () => okImage })

    const result = await ImageGenerator.of('A donut')
      .model('failimg/v1')
      .failover('noimg/v1', 'okimg/v1')
      .generate()
    assert.equal(result.images[0]!.base64, 'OK')
  })

  it('AudioGenerator falls back across providers', async () => {
    AiRegistry.reset()
    const failTts: import('./types.js').TextToSpeechAdapter = {
      async generate() { throw new Error('tts down') },
    }
    const okTts: import('./types.js').TextToSpeechAdapter = {
      async generate(opts) {
        return { audio: Buffer.from('audio-bytes'), format: opts.format ?? 'mp3', model: opts.model ?? 'ok' }
      },
    }
    AiRegistry.register({ name: 'failtts', create: (m) => mockFactory.create(m), createTts: () => failTts })
    AiRegistry.register({ name: 'oktts',  create: (m) => mockFactory.create(m), createTts: () => okTts })

    const result = await AudioGenerator.of('Hi').model('failtts/v1').failover('oktts/v1').generate()
    assert.equal(result.audio.toString(), 'audio-bytes')
  })

  it('Transcription falls back across providers', async () => {
    AiRegistry.reset()
    const failStt: import('./types.js').SpeechToTextAdapter = {
      async transcribe() { throw new Error('stt down') },
    }
    const okStt: import('./types.js').SpeechToTextAdapter = {
      async transcribe(opts) { return { text: 'hello', language: opts.language, model: opts.model ?? 'ok' } },
    }
    AiRegistry.register({ name: 'failstt', create: (m) => mockFactory.create(m), createStt: () => failStt })
    AiRegistry.register({ name: 'okstt',  create: (m) => mockFactory.create(m), createStt: () => okStt })

    const result = await Transcription.fromBytes(new Uint8Array([1, 2, 3]))
      .model('failstt/v1')
      .failover('okstt/v1')
      .generate()
    assert.equal(result.text, 'hello')
  })

  it('does not call fallback when primary succeeds', async () => {
    AiRegistry.reset()
    let primaryCalls = 0
    let fallbackCalls = 0
    const primary: import('./types.js').ImageGenerationAdapter = {
      async generate() { primaryCalls++; return { images: [{ base64: 'P' }], model: 'p' } },
    }
    const fallback: import('./types.js').ImageGenerationAdapter = {
      async generate() { fallbackCalls++; throw new Error('should not be called') },
    }
    AiRegistry.register({ name: 'primary',  create: (m) => mockFactory.create(m), createImage: () => primary })
    AiRegistry.register({ name: 'fallback', create: (m) => mockFactory.create(m), createImage: () => fallback })

    await ImageGenerator.of('x').model('primary/v1').failover('fallback/v1').generate()
    assert.equal(primaryCalls, 1)
    assert.equal(fallbackCalls, 0)
  })
})

// ─── AiFake ───────────────────────────────────────────────

import { AiFake } from './fake.js'

describe('AiFake', () => {
  it('fake() intercepts prompt calls', async () => {
    const fake = AiFake.fake()
    fake.respondWith('Mocked!')

    const response = await AI.prompt('Hello')
    assert.strictEqual(response.text, 'Mocked!')
    fake.restore()
  })

  it('assertPrompted() verifies a prompt was sent', async () => {
    const fake = AiFake.fake()
    fake.respondWith('Ok')

    await AI.prompt('Test prompt')
    fake.assertPrompted(input => input.includes('Test'))
    fake.restore()
  })

  it('assertPrompted() throws when no prompts', () => {
    const fake = AiFake.fake()
    assert.throws(() => fake.assertPrompted(), /Expected at least one prompt/)
    fake.restore()
  })

  it('assertNothingPrompted() passes when no prompts', () => {
    const fake = AiFake.fake()
    fake.assertNothingPrompted()
    fake.restore()
  })

  it('assertNothingPrompted() throws when prompts exist', async () => {
    const fake = AiFake.fake()
    await AI.prompt('Hi')
    assert.throws(() => fake.assertNothingPrompted(), /Expected no prompts/)
    fake.restore()
  })

  it('preventStrayPrompts() throws on unscripted prompt', async () => {
    const fake = AiFake.fake().preventStrayPrompts()
    await assert.rejects(() => AI.prompt('unexpected'), /Stray prompt/)
    fake.restore()
  })

  it('preventStrayPrompts() allows scripted prompts via respondWithSequence', async () => {
    const fake = AiFake.fake().preventStrayPrompts()
    fake.respondWithSequence([{ text: 'expected' }])
    const r = await AI.prompt('hi')
    assert.equal(r.text, 'expected')
    fake.restore()
  })

  it('preventStrayPrompts() throws on prompts beyond the scripted sequence', async () => {
    const fake = AiFake.fake().preventStrayPrompts()
    fake.respondWithSequence([{ text: 'first' }])
    await AI.prompt('one')   // OK
    await assert.rejects(() => AI.prompt('two'), /Stray prompt/)
    fake.restore()
  })

  it('preventStrayPrompts() ignores ambient respondWith()', async () => {
    const fake = AiFake.fake()
    fake.respondWith('ambient')
    fake.preventStrayPrompts()
    await assert.rejects(() => AI.prompt('hi'), /Stray prompt/)
    fake.restore()
  })

  it('preventStrayPrompts() applies to streaming mode too', async () => {
    const fake = AiFake.fake().preventStrayPrompts()
    class StreamingAgent extends Agent { instructions() { return '' } }
    const { stream, response } = new StreamingAgent().stream('hi')
    // Swallow the response rejection so it doesn't surface as unhandled.
    response.catch(() => {})
    await assert.rejects(async () => {
      for await (const _ of stream) { /* drain */ }
    }, /Stray prompt/)
    fake.restore()
  })

  it('getCalls() returns recorded calls', async () => {
    const fake = AiFake.fake()
    await AI.prompt('Hello world')
    const calls = fake.getCalls()
    assert.strictEqual(calls.length, 1)
    assert.ok(calls[0]!.messages.some(m => m.content === 'Hello world'))
    fake.restore()
  })

  it('respondWithSequence drives a multi-step tool-call loop end-to-end', async () => {
    const fake = AiFake.fake()
    let toolRanWith: string | undefined
    const greet = toolDefinition({
      name: 'greet',
      description: 'Greet someone',
      inputSchema: z.object({ name: z.string() }),
    }).server(async ({ name }) => { toolRanWith = name; return `Hi ${name}!` })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'tc-1', name: 'greet', arguments: { name: 'World' } }] },
      { text: 'Greeted World.' },
    ])

    const response = await agent({ instructions: 'sys', tools: [greet] }).prompt('go')

    assert.strictEqual(toolRanWith, 'World')
    assert.strictEqual(response.text, 'Greeted World.')
    assert.strictEqual(response.steps.length, 2)
    assert.strictEqual(fake.getCalls().length, 2)
    fake.restore()
  })

  it('respondWithSequence falls back to respondWith when sequence is exhausted', async () => {
    const fake = AiFake.fake()
    fake.respondWith('fallback text')
    fake.respondWithSequence([{ text: 'first' }])

    const r1 = await AI.prompt('one')
    const r2 = await AI.prompt('two')

    assert.strictEqual(r1.text, 'first')
    assert.strictEqual(r2.text, 'fallback text')
    fake.restore()
  })

  it('failOnStep throws on the targeted provider call', async () => {
    const fake = AiFake.fake()
    const boom = new Error('Rate limited')
    fake.failOnStep(0, boom)

    await assert.rejects(() => AI.prompt('hi'), /Rate limited/)
    // The call was still recorded — useful for "no retry" assertions.
    assert.strictEqual(fake.getCalls().length, 1)
    fake.restore()
  })

  it('failOnStep + respondWithSequence composes (step 0 throws, step 1 returns text on retry)', async () => {
    // Models a transient-failure-then-success scenario where the agent's
    // failover or onError middleware is expected to retry.
    const fake = AiFake.fake()
    fake.failOnStep(0, new Error('Transient'))
    fake.respondWithSequence([
      { text: 'should not be used (step 0 throws)' },
      { text: 'recovered' },
    ])

    await assert.rejects(() => AI.prompt('first'), /Transient/)
    const r2 = await AI.prompt('second')
    // Step 1 of the sequence is consumed because step 0's call still
    // incremented the counter even though it threw.
    assert.strictEqual(r2.text, 'recovered')
    fake.restore()
  })

  it('respondWithSequence works with the streaming variant', async () => {
    const fake = AiFake.fake()
    fake.respondWithSequence([
      { toolCalls: [{ id: 'tc-s-1', name: 'ping', arguments: {} }] },
      { text: 'streamed reply' },
    ])

    const ping = toolDefinition({
      name: 'ping',
      description: 'ping',
      inputSchema: z.object({}),
    }).server(async () => 'pong')

    const a = agent({ instructions: 'sys', tools: [ping] })
    const { stream, response } = a.stream('go')
    const types: string[] = []
    for await (const chunk of stream) types.push(chunk.type)

    const final = await response
    assert.strictEqual(final.text, 'streamed reply')
    assert.ok(types.includes('tool-call'), `expected tool-call chunk, got: ${types.join(',')}`)
    fake.restore()
  })

  it('respondWithSequence resets the call counter so step indices are relative', async () => {
    const fake = AiFake.fake()
    fake.respondWith('ignored')
    await AI.prompt('warmup-1')
    await AI.prompt('warmup-2')
    assert.strictEqual(fake.getCalls().length, 2)

    // Scripting a new scenario rewinds the counter so step 0 = next call.
    fake.respondWithSequence([{ text: 'fresh-step-0' }])
    const r = await AI.prompt('go')
    assert.strictEqual(r.text, 'fresh-step-0')
    assert.strictEqual(fake.getCalls().length, 1)
    fake.restore()
  })
})

// ─── AiProvider ───────────────────────────────────────────

import { AiProvider } from './server/provider.js'
import * as _core from '@rudderjs/core'

describe('AiProvider', () => {
  it('is a ServiceProvider class', () => {
    assert.ok(typeof AiProvider === 'function')
    assert.ok(AiProvider.prototype)
  })
})

describe('AiProvider — empty apiKey skip-and-warn', () => {
  // Fake `app` object — AiProvider only needs `.instance` and `.container.has`.
  function makeFakeApp(): never {
    return {
      instance: () => undefined,
      container: { has: () => false },
      make:      () => undefined,
    } as never
  }

  async function bootWith(aiConfig: Record<string, unknown>): Promise<string[]> {
    AiRegistry.reset()
    const previousRepo = _core.getConfigRepository?.()
    _core.drainBootNotices() // clear any buffered notices before this boot

    _core.setConfigRepository(new _core.ConfigRepository({ ai: aiConfig }))
    try {
      const provider = new AiProvider(makeFakeApp())
      await provider.boot()
    } finally {
      if (previousRepo) _core.setConfigRepository(previousRepo)
    }
    // Skipped providers now register a grouped boot notice (scope 'ai') instead
    // of console.warn-ing inline; the framework flushes them after the tree.
    return _core.drainBootNotices().map(n => `${n.scope}: ${n.message}`)
  }

  it('boots cleanly when an apiKey-requiring provider has empty apiKey, warns once', async () => {
    const warnings = await bootWith({
      default:   'anthropic/claude-sonnet-4-5',
      providers: {
        anthropic: { driver: 'anthropic', apiKey: '' },
      },
    })

    assert.equal(warnings.length, 1, 'one notice for the skipped anthropic provider')
    assert.match(warnings[0]!, /anthropic skipped/)
    assert.match(warnings[0]!, /no API key/)
    assert.throws(
      () => AiRegistry.getFactory('anthropic'),
      /Unknown AI provider "anthropic"/,
      'anthropic should not be registered',
    )
  })

  it('registers providers that DO have a key while skipping ones that don\'t', async () => {
    const warnings = await bootWith({
      default:   'anthropic/claude-sonnet-4-5',
      providers: {
        anthropic: { driver: 'anthropic', apiKey: 'sk-real-key' },
        openai:    { driver: 'openai',    apiKey: '' },
        google:    { driver: 'google',    apiKey: '' },
        ollama:    { driver: 'ollama',    baseUrl: 'http://localhost:11434' },
      },
    })

    assert.equal(warnings.length, 2, 'two notices — openai + google')
    assert.ok(warnings.some(w => /openai skipped/.test(w)), 'openai noticed')
    assert.ok(warnings.some(w => /google skipped/.test(w)), 'google noticed')

    assert.doesNotThrow(() => AiRegistry.getFactory('anthropic'), 'anthropic registered')
    assert.doesNotThrow(() => AiRegistry.getFactory('ollama'),    'ollama registered (no apiKey needed)')
    assert.throws(() => AiRegistry.getFactory('openai'), /Unknown AI provider "openai"/)
    assert.throws(() => AiRegistry.getFactory('google'), /Unknown AI provider "google"/)
  })

  it('boots clean with zero providers configured', async () => {
    const warnings = await bootWith({
      default:   'anthropic/claude-sonnet-4-5',
      providers: {},
    })

    assert.equal(warnings.length, 0, 'no warnings when no providers are configured')
  })

  it('boots clean when every apiKey-requiring provider is empty (matches fresh-scaffolded state)', async () => {
    // Reproduces the scaffolder's default ai.ts: anthropic/openai/google all
    // present, all reading from env vars that haven't been set yet, plus
    // ollama (no apiKey needed). Pre-fix this would crash on the first one.
    const warnings = await bootWith({
      default:   'anthropic/claude-sonnet-4-5',
      providers: {
        anthropic: { driver: 'anthropic', apiKey: '' },
        openai:    { driver: 'openai',    apiKey: '' },
        google:    { driver: 'google',    apiKey: '' },
        ollama:    { driver: 'ollama',    baseUrl: 'http://localhost:11434' },
      },
    })

    assert.equal(warnings.length, 3, 'one warning per apiKey-requiring provider')
    assert.doesNotThrow(() => AiRegistry.getFactory('ollama'), 'ollama still registers')
  })
})

// ─── Client tools + tool approval ────────────────────────────
//
// A scriptable mock provider lets each test queue up provider responses
// (text and/or tool_calls) so we can simulate multi-turn loops.

import { dynamicTool } from './tool.js'
import type { ToolCall as _ToolCall } from './types.js'

interface ScriptedResponse {
  text?: string
  toolCalls?: _ToolCall[]
  finishReason?: ProviderResponse['finishReason']
}

let _script: ScriptedResponse[] = []
let _calls: ProviderRequestOptions[] = []

function installScriptedFake() {
  _script = []
  _calls = []
  const adapter: ProviderAdapter = {
    async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
      _calls.push(opts)
      const next = _script.shift() ?? { text: 'done', finishReason: 'stop' as const }
      return {
        message: {
          role: 'assistant',
          content: next.text ?? '',
          ...(next.toolCalls ? { toolCalls: next.toolCalls } : {}),
        },
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: next.finishReason ?? (next.toolCalls ? 'tool_calls' : 'stop'),
      }
    },
    async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
      _calls.push(opts)
      const next = _script.shift() ?? { text: 'done', finishReason: 'stop' as const }
      if (next.text) yield { type: 'text-delta', text: next.text }
      if (next.toolCalls) {
        for (const tc of next.toolCalls) {
          yield { type: 'tool-call', toolCall: tc }
        }
      }
      yield {
        type: 'finish',
        finishReason: next.finishReason ?? (next.toolCalls ? 'tool_calls' : 'stop'),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }
    },
  }
  AiRegistry.reset()
  AiRegistry.register({ name: '__loop_test__', create: () => adapter })
  AiRegistry.setDefault('__loop_test__/test')
}

describe('client tool execution', () => {
  beforeEach(() => installScriptedFake())

  it('placeholder mode (default) writes a placeholder result and continues the loop', async () => {
    const clientTool = toolDefinition({
      name: 'apply_theme',
      description: 'Apply a UI theme',
      inputSchema: z.object({ theme: z.string() }),
    })

    _script = [
      { toolCalls: [{ id: 'c1', name: 'apply_theme', arguments: { theme: 'dark' } }] },
      { text: 'Theme applied.' },
    ]

    const result = await agent({ instructions: 'sys', tools: [clientTool] }).prompt('go')

    assert.strictEqual(result.steps.length, 2)
    assert.strictEqual(result.text, 'Theme applied.')
    assert.strictEqual(result.finishReason, undefined)
    assert.strictEqual(result.pendingClientToolCalls, undefined)
  })

  it('stop-on-client-tool mode breaks out and exposes the pending call', async () => {
    const clientTool = toolDefinition({
      name: 'read_form_state',
      description: 'Read local form values',
      inputSchema: z.object({}),
    })

    _script = [
      { toolCalls: [{ id: 'c1', name: 'read_form_state', arguments: {} }] },
      { text: 'should not be reached' },
    ]

    const result = await agent({ instructions: 'sys', tools: [clientTool] })
      .prompt('go', { toolCallStreamingMode: 'stop-on-client-tool' })

    assert.strictEqual(result.finishReason, 'client_tool_calls')
    assert.strictEqual(result.pendingClientToolCalls?.length, 1)
    assert.strictEqual(result.pendingClientToolCalls?.[0]?.name, 'read_form_state')
    assert.strictEqual(_calls.length, 1, 'loop must not have made a second provider call')
  })

  it('streaming variant emits a pending-client-tools chunk and stops', async () => {
    const clientTool = toolDefinition({
      name: 'ping',
      description: 'ping',
      inputSchema: z.object({}),
    })

    _script = [
      { toolCalls: [{ id: 'c1', name: 'ping', arguments: {} }] },
    ]

    const a = agent({ instructions: 'sys', tools: [clientTool] })
    const { stream, response } = a.stream('go', { toolCallStreamingMode: 'stop-on-client-tool' })

    const chunkTypes: string[] = []
    for await (const chunk of stream) chunkTypes.push(chunk.type)

    const result = await response
    assert.strictEqual(result.finishReason, 'client_tool_calls')
    assert.strictEqual(result.pendingClientToolCalls?.length, 1)
    assert.ok(chunkTypes.includes('pending-client-tools'), `expected pending-client-tools, got: ${chunkTypes.join(',')}`)
  })

  it('dynamicTool() builds a Tool whose input is unknown', () => {
    const t = dynamicTool({
      name: 'runtime_built',
      description: 'built at runtime',
      inputSchema: z.object({ q: z.string() }),
    }).server(async (input) => JSON.stringify(input))
    assert.strictEqual(t.definition.name, 'runtime_built')
    assert.ok(typeof t.execute === 'function')
  })
})

describe('tool approval enforcement', () => {
  beforeEach(() => installScriptedFake())

  it('server tool with needsApproval: true stops the loop and does NOT execute', async () => {
    let executed = false
    const dangerousTool = toolDefinition({
      name: 'delete_record',
      description: 'delete',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executed = true; return 'deleted' })

    _script = [
      { toolCalls: [{ id: 't1', name: 'delete_record', arguments: { id: '42' } }] },
    ]

    const result = await agent({ instructions: 'sys', tools: [dangerousTool] }).prompt('go')

    assert.strictEqual(result.finishReason, 'tool_approval_required')
    assert.strictEqual(result.pendingApprovalToolCall?.toolCall.id, 't1')
    assert.strictEqual(result.pendingApprovalToolCall?.isClientTool, false)
    assert.strictEqual(executed, false)
  })

  it('predicate variant only stops when predicate returns true', async () => {
    let executions = 0
    const tool = toolDefinition({
      name: 'op',
      description: 'op',
      inputSchema: z.object({ destructive: z.boolean() }),
      needsApproval: (args: { destructive: boolean }) => args.destructive === true,
    }).server(async () => { executions++; return 'ok' })

    _script = [
      { toolCalls: [{ id: 'a1', name: 'op', arguments: { destructive: false } }] },
      { text: 'done' },
    ]
    const r1 = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')
    assert.strictEqual(r1.finishReason, undefined)
    assert.strictEqual(executions, 1)

    _script = [
      { toolCalls: [{ id: 'a2', name: 'op', arguments: { destructive: true } }] },
    ]
    const r2 = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')
    assert.strictEqual(r2.finishReason, 'tool_approval_required')
    assert.strictEqual(executions, 1)
  })

  it('approval continuation: executes server tool and emits resumedToolMessages', async () => {
    let executions = 0
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executions++; return 'deleted' })

    // Continuation: messages already contain the prior assistant{toolCalls}
    // (no fresh provider call should be needed before executing the tool).
    _script = [
      { text: 'All done.' },  // first iteration after resume executes
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] })
      .prompt('', {
        messages: [
          { role: 'user', content: 'delete this record' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'res-1', name: 'delete_record', arguments: { id: '99' } }],
          },
        ],
        approvedToolCallIds: ['res-1'],
      })

    assert.strictEqual(executions, 1, 'tool must execute exactly once')
    assert.strictEqual(result.text, 'All done.')
    assert.strictEqual(result.finishReason, undefined)
    assert.strictEqual(result.resumedToolMessages?.length, 1)
    assert.strictEqual(result.resumedToolMessages?.[0]?.role, 'tool')
    assert.strictEqual(result.resumedToolMessages?.[0]?.toolCallId, 'res-1')
    assert.strictEqual(result.resumedToolMessages?.[0]?.content, 'deleted')
  })

  it('approval continuation: rejects without executing', async () => {
    let executions = 0
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executions++; return 'deleted' })

    _script = [{ text: 'OK, will not delete.' }]

    const result = await agent({ instructions: 'sys', tools: [tool] })
      .prompt('', {
        messages: [
          { role: 'user', content: 'delete this record' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'res-1', name: 'delete_record', arguments: { id: '99' } }],
          },
        ],
        rejectedToolCallIds: ['res-1'],
      })

    assert.strictEqual(executions, 0)
    assert.strictEqual(result.resumedToolMessages?.length, 1)
    const rej = JSON.parse(result.resumedToolMessages![0]!.content as string)
    assert.strictEqual(rej.rejected, true)
  })

  it('approvedToolCallIds lets the tool execute on the next run', async () => {
    let executed = false
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executed = true; return 'deleted' })

    _script = [
      { toolCalls: [{ id: 'apv-1', name: 'delete_record', arguments: { id: '7' } }] },
      { text: 'all done' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] })
      .prompt('go', { approvedToolCallIds: ['apv-1'] })

    assert.strictEqual(executed, true)
    assert.strictEqual(result.text, 'all done')
    assert.strictEqual(result.finishReason, undefined)
  })

  it('streaming variant emits a pending-approval chunk and stops', async () => {
    let executed = false
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executed = true; return 'deleted' })

    _script = [
      { toolCalls: [{ id: 's1', name: 'delete_record', arguments: { id: '99' } }] },
    ]

    const a = agent({ instructions: 'sys', tools: [tool] })
    const { stream, response } = a.stream('go')

    const chunkTypes: string[] = []
    for await (const chunk of stream) chunkTypes.push(chunk.type)

    const result = await response
    assert.strictEqual(result.finishReason, 'tool_approval_required')
    assert.strictEqual(result.pendingApprovalToolCall?.toolCall.id, 's1')
    assert.strictEqual(executed, false)
    assert.ok(chunkTypes.includes('pending-approval'), `expected pending-approval chunk, got: ${chunkTypes.join(',')}`)
  })

  it('rejectedToolCallIds skips execution and continues with a rejection result', async () => {
    let executed = false
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executed = true; return 'deleted' })

    _script = [
      { toolCalls: [{ id: 'rej-1', name: 'delete_record', arguments: { id: '7' } }] },
      { text: 'understood, no delete' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] })
      .prompt('go', { rejectedToolCallIds: ['rej-1'] })

    assert.strictEqual(executed, false)
    assert.strictEqual(result.text, 'understood, no delete')
    assert.strictEqual(result.finishReason, undefined)
    const firstStep = result.steps[0]
    assert.ok(firstStep)
    const toolResult = firstStep.toolResults[0]
    assert.ok(toolResult)
    assert.deepEqual(toolResult.result, { rejected: true, reason: 'User rejected this tool call' })
  })
})

// ─── Async-generator tool execute (Phase 1: tool-update streaming) ────────

describe('async-generator tool execute', () => {
  beforeEach(() => installScriptedFake())

  it('streaming loop emits a tool-update chunk for each yield, then tool-result with the return value', async () => {
    const search = toolDefinition({
      name: 'search',
      description: 'streamed search',
      inputSchema: z.object({ q: z.string() }),
    }).server(async function* ({ q }) {
      yield { state: 'searching', query: q }
      yield { state: 'ranking', count: 3 }
      return { hits: ['a', 'b', 'c'] }
    })

    _script = [
      { toolCalls: [{ id: 'tc-stream-1', name: 'search', arguments: { q: 'hello' } }] },
      { text: 'Done.' },
    ]

    const a = agent({ instructions: 'sys', tools: [search] })
    const { stream, response } = a.stream('go')

    const collected: StreamChunk[] = []
    for await (const chunk of stream) collected.push(chunk)

    const updates = collected.filter(c => c.type === 'tool-update')
    const results = collected.filter(c => c.type === 'tool-result')

    assert.strictEqual(updates.length, 2, 'expected 2 tool-update chunks (one per yield)')
    assert.deepEqual(updates[0]!.update, { state: 'searching', query: 'hello' })
    assert.deepEqual(updates[1]!.update, { state: 'ranking', count: 3 })
    assert.strictEqual(updates[0]!.toolCall?.id, 'tc-stream-1')

    assert.strictEqual(results.length, 1, 'expected exactly one tool-result chunk')
    assert.deepEqual(results[0]!.result, { hits: ['a', 'b', 'c'] })

    // Order check: every tool-update must come after at least one tool-call
    // and before the tool-result. (The provider mock + loop both emit
    // tool-call, so we don't pin the count of tool-calls.)
    const types = collected.map(c => c.type)
    const firstUpdate = types.indexOf('tool-update')
    const lastUpdate = types.lastIndexOf('tool-update')
    const lastToolCall = types.lastIndexOf('tool-call')
    const toolResultIdx = types.indexOf('tool-result')
    assert.ok(lastToolCall < firstUpdate, 'tool-call must precede tool-update')
    assert.ok(lastUpdate < toolResultIdx, 'tool-update must precede tool-result')

    const final = await response
    assert.strictEqual(final.text, 'Done.')
    assert.strictEqual(final.steps.length, 2)
    assert.deepEqual(final.steps[0]!.toolResults[0]!.result, { hits: ['a', 'b', 'c'] })
  })

  it('non-streaming agent.prompt() drains generator yields and captures the return value', async () => {
    const yielded: unknown[] = []
    const tool = toolDefinition({
      name: 'gen_tool',
      description: 'generator under prompt()',
      inputSchema: z.object({}),
    }).server(async function* () {
      yielded.push('first')
      yield { progress: 1 }
      yielded.push('second')
      yield { progress: 2 }
      yielded.push('done')
      return 'final-value'
    })

    _script = [
      { toolCalls: [{ id: 'tc-prompt-1', name: 'gen_tool', arguments: {} }] },
      { text: 'OK' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')

    // Generator ran to completion
    assert.deepEqual(yielded, ['first', 'second', 'done'])
    // The return value (not a yielded value) is what surfaces in toolResults
    assert.strictEqual(result.steps[0]!.toolResults[0]!.result, 'final-value')
    // The next model step saw the stringified return value
    assert.strictEqual(result.text, 'OK')
  })

  it('middleware onChunk sees tool-update chunks', async () => {
    const seen: StreamChunk[] = []
    const recorder: AiMiddleware = {
      name: 'recorder',
      onChunk(_ctx, chunk) {
        seen.push(chunk)
        return chunk
      },
    }

    const tool = toolDefinition({
      name: 'gen_mw',
      description: 'generator with middleware',
      inputSchema: z.object({}),
    }).server(async function* () {
      yield { step: 'a' }
      yield { step: 'b' }
      return 'done'
    })

    _script = [
      { toolCalls: [{ id: 'tc-mw-1', name: 'gen_mw', arguments: {} }] },
      { text: 'finished' },
    ]

    const a = agent({ instructions: 'sys', tools: [tool], middleware: [recorder] })
    const { stream, response } = a.stream('go')
    for await (const _ of stream) { /* drain */ }
    await response

    const updateChunksSeenByMw = seen.filter(c => c.type === 'tool-update')
    assert.strictEqual(updateChunksSeenByMw.length, 2, 'middleware should observe both tool-update chunks')
    assert.deepEqual(updateChunksSeenByMw[0]!.update, { step: 'a' })
    assert.deepEqual(updateChunksSeenByMw[1]!.update, { step: 'b' })
  })
})

// ─── toModelOutput (Phase 2: decouple model-input from UI/result) ──────────

describe('toModelOutput', () => {
  beforeEach(() => installScriptedFake())

  it('narrows the next-step model input while UI/toolResults keep the original', async () => {
    const richTool = toolDefinition({
      name: 'search',
      description: 'returns a rich payload',
      inputSchema: z.object({ q: z.string() }),
    })
      .server(async () => ({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }))
      .modelOutput((result) => `${result.items.length} items found`)

    _script = [
      { toolCalls: [{ id: 'tmo-1', name: 'search', arguments: { q: 'x' } }] },
      { text: 'cool' },
    ]

    const result = await agent({ instructions: 'sys', tools: [richTool] }).prompt('go')

    // toolResults preserves the ORIGINAL structured result.
    assert.deepEqual(result.steps[0]!.toolResults[0]!.result, {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    })

    // The next provider call must have seen the SUMMARIZED string in the
    // tool message, not the JSON-encoded original.
    const secondCall = _calls[1]
    assert.ok(secondCall, 'expected a second provider call after the tool ran')
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'tmo-1')
    assert.ok(toolMsg, 'expected a tool message in the next provider call')
    assert.strictEqual(toolMsg.content, '3 items found')
  })

  it('streaming tool-result chunk still carries the original structured value', async () => {
    const richTool = toolDefinition({
      name: 'lookup',
      description: 'rich + summarized',
      inputSchema: z.object({}),
    })
      .server(async () => ({ payload: { a: 1, b: 2 }, big: 'x'.repeat(50) }))
      .modelOutput(() => 'OK')

    _script = [
      { toolCalls: [{ id: 'tmo-2', name: 'lookup', arguments: {} }] },
      { text: 'done' },
    ]

    const a = agent({ instructions: 'sys', tools: [richTool] })
    const { stream, response } = a.stream('go')
    const collected: StreamChunk[] = []
    for await (const chunk of stream) collected.push(chunk)
    await response

    const toolResultChunk = collected.find(c => c.type === 'tool-result' && c.toolCall?.id === 'tmo-2')
    assert.ok(toolResultChunk, 'expected a tool-result chunk for the call')
    assert.deepEqual(toolResultChunk.result, {
      payload: { a: 1, b: 2 },
      big: 'x'.repeat(50),
    })

    // And the second provider call's tool message used the summary.
    const secondCall = _calls[1]
    assert.ok(secondCall)
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'tmo-2')
    assert.strictEqual(toolMsg?.content, 'OK')
  })

  it('regression: tool without modelOutput is unchanged (default JSON.stringify)', async () => {
    const plainTool = toolDefinition({
      name: 'plain',
      description: 'no modelOutput',
      inputSchema: z.object({}),
    }).server(async () => ({ value: 42 }))

    _script = [
      { toolCalls: [{ id: 'tmo-3', name: 'plain', arguments: {} }] },
      { text: 'k' },
    ]

    await agent({ instructions: 'sys', tools: [plainTool] }).prompt('go')

    const secondCall = _calls[1]
    assert.ok(secondCall)
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'tmo-3')
    assert.strictEqual(toolMsg?.content, JSON.stringify({ value: 42 }))
  })

  it('throwing modelOutput falls back to default stringify and surfaces via onError', async () => {
    const errors: unknown[] = []
    const recorder: AiMiddleware = {
      name: 'err-recorder',
      onError(_ctx, err) { errors.push(err) },
    }

    const tool = toolDefinition({
      name: 'boom',
      description: 'modelOutput throws',
      inputSchema: z.object({}),
    })
      .server(async () => ({ value: 'real' }))
      .modelOutput(() => { throw new Error('formatter exploded') })

    _script = [
      { toolCalls: [{ id: 'tmo-4', name: 'boom', arguments: {} }] },
      { text: 'k' },
    ]

    await agent({ instructions: 'sys', tools: [tool], middleware: [recorder] }).prompt('go')

    // Loop did not crash; second call happened.
    assert.strictEqual(_calls.length, 2)
    const secondCall = _calls[1]!
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'tmo-4')
    // Fell back to default stringify.
    assert.strictEqual(toolMsg?.content, JSON.stringify({ value: 'real' }))
    // Error was surfaced through onError middleware.
    assert.strictEqual(errors.length, 1)
    assert.ok(errors[0] instanceof Error)
    assert.match((errors[0] as Error).message, /formatter exploded/)
  })

  // Regression: combining a generator-style .server() with .modelOutput()
  // must infer the generator's RETURN type for the modelOutput callback,
  // not the AsyncGenerator wrapper. The original Phase 2 overloads put the
  // plain-async signature first, which made TypeScript bind
  // `TReturn = AsyncGenerator<TUpdate, TActualReturn, void>` and broke
  // chained refinements. Caught by the playground; this test guards it.
  it('generator + modelOutput infers the return type, not the AsyncGenerator wrapper', async () => {
    const tool = toolDefinition({
      name: 'gen_with_summary',
      description: 'streams progress, summarizes for the model',
      inputSchema: z.object({}),
    })
      .server(async function* () {
        yield { phase: 'one' }
        yield { phase: 'two' }
        return { hits: ['a', 'b', 'c'], totalScanned: 100 }
      })
      // If TS regresses, `result` here gets the AsyncGenerator type and the
      // following property accesses fail to compile.
      .modelOutput((result) =>
        `Search complete — ${result.hits.length} hits out of ${result.totalScanned} scanned`,
      )

    _script = [
      { toolCalls: [{ id: 'tmo-gen-1', name: 'gen_with_summary', arguments: {} }] },
      { text: 'ack' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')

    // Original structured value still in toolResults.
    assert.deepEqual(result.steps[0]!.toolResults[0]!.result, {
      hits: ['a', 'b', 'c'],
      totalScanned: 100,
    })

    // Model saw the summary string, not the JSON.
    const secondCall = _calls[1]
    assert.ok(secondCall)
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'tmo-gen-1')
    assert.strictEqual(toolMsg?.content, 'Search complete — 3 hits out of 100 scanned')
  })
})

// ─── Tool argument validation ────────────────────────────────────────────

describe('tool argument validation', () => {
  beforeEach(() => installScriptedFake())

  it('type mismatch: execute is not called and a structured error is fed to the model', async () => {
    let executions = 0
    const tool = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({ q: z.string() }),
    }).server(async () => { executions++; return 'should not be reached' })

    _script = [
      // Model returns a number where a string is required.
      { toolCalls: [{ id: 'iv-1', name: 'lookup', arguments: { q: 42 } }] },
      { text: 'ok, retrying' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')

    assert.strictEqual(executions, 0, 'execute must not run for invalid args')
    const tr = result.steps[0]!.toolResults[0]!
    assert.deepEqual((tr.result as { error: string }).error, 'invalid_arguments')
    assert.ok(Array.isArray((tr.result as { issues: unknown[] }).issues))
    assert.ok((tr.result as { issues: { path: string }[] }).issues.length > 0)

    // The next provider call must have seen the structured error in the
    // tool message so the model can correct itself on the next turn.
    const secondCall = _calls[1]!
    const toolMsg = secondCall.messages.find(m => m.role === 'tool' && m.toolCallId === 'iv-1')!
    const parsed = JSON.parse(toolMsg.content as string)
    assert.strictEqual(parsed.error, 'invalid_arguments')
    assert.strictEqual(result.text, 'ok, retrying')
  })

  it('missing required field surfaces an issue with the field path', async () => {
    const tool = toolDefinition({
      name: 'greet',
      description: 'greet',
      inputSchema: z.object({ name: z.string(), greeting: z.string() }),
    }).server(async () => 'unreached')

    _script = [
      { toolCalls: [{ id: 'iv-2', name: 'greet', arguments: { name: 'world' } }] }, // missing greeting
      { text: 'ack' },
    ]

    const result = await agent({ instructions: 'sys', tools: [tool] }).prompt('go')
    const err = result.steps[0]!.toolResults[0]!.result as { issues: { path: string }[] }
    assert.ok(err.issues.some(i => i.path === 'greeting'), `expected an issue at path "greeting"; got ${JSON.stringify(err.issues)}`)
  })

  it('zod defaults are applied: execute receives the parsed value', async () => {
    let received: unknown
    const tool = toolDefinition({
      name: 'with_default',
      description: 'has a default',
      inputSchema: z.object({ q: z.string(), limit: z.number().default(10) }),
    }).server(async (input) => { received = input; return 'ok' })

    _script = [
      // Model omits `limit`; the default should be applied before execute().
      { toolCalls: [{ id: 'iv-3', name: 'with_default', arguments: { q: 'hi' } }] },
      { text: 'done' },
    ]

    await agent({ instructions: 'sys', tools: [tool] }).prompt('go')
    assert.deepStrictEqual(received, { q: 'hi', limit: 10 })
  })

  it('zod transforms are applied: execute receives the transformed value', async () => {
    let received: unknown
    const tool = toolDefinition({
      name: 'shout',
      description: 'uppercase',
      inputSchema: z.object({ msg: z.string().transform(s => s.toUpperCase()) }),
    }).server(async (input) => { received = input; return 'ok' })

    _script = [
      { toolCalls: [{ id: 'iv-4', name: 'shout', arguments: { msg: 'hi' } }] },
      { text: 'done' },
    ]

    await agent({ instructions: 'sys', tools: [tool] }).prompt('go')
    assert.deepStrictEqual(received, { msg: 'HI' })
  })

  it('streaming variant emits paired tool-call → tool-result(error) chunks on validation failure', async () => {
    const tool = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({ q: z.string() }),
    }).server(async () => 'unreached')

    _script = [
      { toolCalls: [{ id: 'iv-5', name: 'lookup', arguments: { q: 99 } }] },
      { text: 'recovered' },
    ]

    const a = agent({ instructions: 'sys', tools: [tool] })
    const { stream, response } = a.stream('go')
    const chunks: StreamChunk[] = []
    for await (const c of stream) chunks.push(c)
    await response

    const callIdx = chunks.findIndex(c => c.type === 'tool-call' && c.toolCall?.id === 'iv-5')
    const resultIdx = chunks.findIndex(c => c.type === 'tool-result' && c.toolCall?.id === 'iv-5')
    assert.ok(callIdx >= 0, 'expected a tool-call chunk for the invalid call')
    assert.ok(resultIdx > callIdx, 'tool-result must come after tool-call')
    assert.strictEqual(
      (chunks[resultIdx]!.result as { error: string }).error,
      'invalid_arguments',
    )
  })

  it('onAfterToolCall middleware fires with the structured error as the result', async () => {
    const seen: Array<{ name: string; result: unknown }> = []
    const recorder: AiMiddleware = {
      name: 'recorder',
      async onAfterToolCall(_ctx, name, _args, result) { seen.push({ name, result }) },
    }
    const tool = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({ q: z.string() }),
    }).server(async () => 'unreached')

    _script = [
      { toolCalls: [{ id: 'iv-6', name: 'lookup', arguments: { q: 1 } }] },
      { text: 'k' },
    ]

    await agent({ instructions: 'sys', tools: [tool], middleware: [recorder] }).prompt('go')

    assert.strictEqual(seen.length, 1)
    assert.strictEqual(seen[0]!.name, 'lookup')
    assert.strictEqual((seen[0]!.result as { error: string }).error, 'invalid_arguments')
  })

  it('approval-resume validates args before executing the approved tool', async () => {
    let executed = false
    const tool = toolDefinition({
      name: 'delete_record',
      description: 'd',
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => { executed = true; return 'deleted' })

    // Caller supplies a continuation message list with bad args (`id: 99`
    // is a number) and approves the call. Validation should reject it
    // before execute runs.
    _script = [{ text: 'understood' }]

    const result = await agent({ instructions: 'sys', tools: [tool] })
      .prompt('', {
        messages: [
          { role: 'user', content: 'do it' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'res-iv', name: 'delete_record', arguments: { id: 99 } }],
          },
        ],
        approvedToolCallIds: ['res-iv'],
      })

    assert.strictEqual(executed, false)
    assert.strictEqual(result.resumedToolMessages?.length, 1)
    const parsed = JSON.parse(result.resumedToolMessages![0]!.content as string)
    assert.strictEqual(parsed.error, 'invalid_arguments')
  })
})

// ─── AbortSignal support ─────────────────────────────────────────────────

describe('AbortSignal support', () => {
  it('pre-aborted signal: prompt() rejects without making a provider call', async () => {
    const fake = AiFake.fake()
    fake.respondWith('would have been mocked')
    const ac = new AbortController()
    ac.abort(new Error('cancelled before start'))

    await assert.rejects(
      () => agent('s').prompt('hi', { signal: ac.signal }),
      /cancelled before start/,
    )
    assert.strictEqual(fake.getCalls().length, 0, 'no provider call should have happened')
    fake.restore()
  })

  it('abort between iterations: loop stops, prompt() rejects, no further provider calls', async () => {
    const fake = AiFake.fake()
    const ac = new AbortController()

    let toolStarted = false
    const slow = toolDefinition({
      name: 'slow',
      description: 'fires the abort during execute',
      inputSchema: z.object({}),
    }).server(async () => { toolStarted = true; ac.abort(new Error('mid-run abort')); return 'done' })

    fake.respondWithSequence([
      { toolCalls: [{ id: 't1', name: 'slow', arguments: {} }] },
      { text: 'should not be reached' },
    ])

    await assert.rejects(
      () => agent({ instructions: 's', tools: [slow] }).prompt('go', { signal: ac.signal }),
      /mid-run abort/,
    )
    assert.strictEqual(toolStarted, true)
    // Only the first provider call should have happened — the next
    // iteration's throwIfAborted() picks up the abort before the second
    // provider call fires.
    assert.strictEqual(fake.getCalls().length, 1)
    fake.restore()
  })

  it('signal is forwarded into ProviderRequestOptions on every provider call', async () => {
    const fake = AiFake.fake()
    fake.respondWith('ok')
    const ac = new AbortController()

    await agent('s').prompt('hi', { signal: ac.signal })
    const calls = fake.getCalls()
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]!.signal, ac.signal, 'provider received the signal')
    fake.restore()
  })

  it('streaming: pre-aborted signal rejects both the stream and the response promise', async () => {
    const fake = AiFake.fake()
    fake.respondWith('would have been mocked')
    const ac = new AbortController()
    ac.abort(new Error('aborted'))

    const { stream, response } = agent('s').stream('hi', { signal: ac.signal })

    let streamThrew = false
    try {
      for await (const _ of stream) { /* drain */ }
    } catch (err) {
      streamThrew = true
      assert.match(err instanceof Error ? err.message : String(err), /aborted/)
    }
    assert.ok(streamThrew, 'stream must throw')
    await assert.rejects(() => response, /aborted/)
    assert.strictEqual(fake.getCalls().length, 0)
    fake.restore()
  })

  it('streaming: mid-run abort surfaces via the stream and rejects the response promise', async () => {
    const fake = AiFake.fake()
    const ac = new AbortController()

    const trigger = toolDefinition({
      name: 'trigger',
      description: 'fires abort while loop is between iterations',
      inputSchema: z.object({}),
    }).server(async () => { ac.abort(new Error('mid-stream abort')); return 'pulled' })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'ts1', name: 'trigger', arguments: {} }] },
      { text: 'unreachable' },
    ])

    const { stream, response } = agent({ instructions: 's', tools: [trigger] })
      .stream('go', { signal: ac.signal })

    let streamThrew = false
    try {
      for await (const _ of stream) { /* drain */ }
    } catch (err) {
      streamThrew = true
      assert.match(err instanceof Error ? err.message : String(err), /mid-stream abort/)
    }
    assert.ok(streamThrew)
    await assert.rejects(() => response, /mid-stream abort/)
    fake.restore()
  })

  it('AbortSignal.timeout(0) cancels the run via the iteration check', async () => {
    const fake = AiFake.fake()
    fake.respondWith('would have been mocked')

    // timeout(0) fires on the next macrotask; wait for it to fire before
    // calling prompt() so the pre-entry throwIfAborted() picks it up.
    const signal = AbortSignal.timeout(0)
    await new Promise(r => setTimeout(r, 5))

    await assert.rejects(
      () => agent('s').prompt('hi', { signal }),
      // Node labels timeouts as DOMException 'TimeoutError'. Accept either
      // a name or a message containing "timeout"/"aborted".
      (err: unknown) => {
        if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'TimeoutError') return true
        const msg = err instanceof Error ? err.message : String(err)
        return /timeout|aborted/i.test(msg)
      },
    )
    assert.strictEqual(fake.getCalls().length, 0)
    fake.restore()
  })
})

// ─── Tool durations on observer events ───────────────────────────────────

import { aiObservers } from './observers.js'
import type { AiEvent } from './observers.js'

describe('tool durations on observer events', () => {
  let captured: AiEvent[] = []
  let unsubscribe: (() => void) | undefined

  beforeEach(() => {
    captured = []
    aiObservers.reset()
    unsubscribe = aiObservers.subscribe((e) => captured.push(e))
  })

  it('captures real wall-clock duration for a tool execute', async () => {
    const fake = AiFake.fake()
    const sleeper = toolDefinition({
      name: 'sleeper',
      description: 'sleeps briefly',
      inputSchema: z.object({}),
    }).server(async () => { await new Promise(r => setTimeout(r, 15)); return 'awake' })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'd1', name: 'sleeper', arguments: {} }] },
      { text: 'done' },
    ])

    await agent({ instructions: 's', tools: [sleeper] }).prompt('go')

    const completed = captured.find(e => e.kind === 'agent.completed')
    assert.ok(completed, 'expected an agent.completed observer event')
    const observerToolCall = completed.steps[0]!.toolCalls[0]!
    assert.strictEqual(observerToolCall.id, 'd1')
    // At least the sleep window. Generous lower bound to avoid CI flake;
    // the point is "non-zero, not hardcoded".
    assert.ok(
      observerToolCall.duration >= 10,
      `expected duration >= 10ms, got ${observerToolCall.duration}`,
    )
    fake.restore()
    unsubscribe?.()
  })

  it('captures duration even when execute throws', async () => {
    const fake = AiFake.fake()
    const flaky = toolDefinition({
      name: 'flaky',
      description: 'fails after a delay',
      inputSchema: z.object({}),
    }).server(async (): Promise<string> => {
      await new Promise(r => setTimeout(r, 10))
      throw new Error('boom')
    })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'd2', name: 'flaky', arguments: {} }] },
      { text: 'noted' },
    ])

    await agent({ instructions: 's', tools: [flaky] }).prompt('go')

    const completed = captured.find(e => e.kind === 'agent.completed')
    assert.ok(completed)
    const observerToolCall = completed.steps[0]!.toolCalls[0]!
    assert.ok(
      observerToolCall.duration >= 5,
      `expected duration >= 5ms even on error, got ${observerToolCall.duration}`,
    )
    fake.restore()
    unsubscribe?.()
  })

  it('streaming variant records duration too', async () => {
    const fake = AiFake.fake()
    const sleeper = toolDefinition({
      name: 'sleeper',
      description: 'sleeps briefly',
      inputSchema: z.object({}),
    }).server(async () => { await new Promise(r => setTimeout(r, 12)); return 'awake' })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'd3', name: 'sleeper', arguments: {} }] },
      { text: 'streamed done' },
    ])

    const { stream, response } = agent({ instructions: 's', tools: [sleeper] }).stream('go')
    for await (const _ of stream) { /* drain */ }
    await response

    const completed = captured.find(e => e.kind === 'agent.completed')
    assert.ok(completed)
    assert.ok(
      completed.steps[0]!.toolCalls[0]!.duration >= 8,
      `expected duration >= 8ms in streaming, got ${completed.steps[0]!.toolCalls[0]!.duration}`,
    )
    fake.restore()
    unsubscribe?.()
  })

  it('paths that skip execute (validation failure) report duration 0', async () => {
    const fake = AiFake.fake()
    let executed = false
    const tool = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({ q: z.string() }),
    }).server(async () => { executed = true; return 'unreached' })

    fake.respondWithSequence([
      { toolCalls: [{ id: 'd4', name: 'lookup', arguments: { q: 99 } }] },
      { text: 'noted' },
    ])

    await agent({ instructions: 's', tools: [tool] }).prompt('go')
    assert.strictEqual(executed, false)

    const completed = captured.find(e => e.kind === 'agent.completed')
    assert.ok(completed)
    // Validation rejected the call before execute ran — duration is 0
    // (no execution to time).
    assert.strictEqual(completed.steps[0]!.toolCalls[0]!.duration, 0)
    fake.restore()
    unsubscribe?.()
  })
})

// ─── Per-step observer event ─────────────────────────────────────────────

describe('agent.step.completed observer event', () => {
  let captured: AiEvent[] = []
  let unsubscribe: (() => void) | undefined

  beforeEach(() => {
    captured = []
    aiObservers.reset()
    unsubscribe = aiObservers.subscribe((e) => captured.push(e))
  })

  it('emits one step event per iteration in non-streaming mode', async () => {
    const fake = AiFake.fake()
    const lookup = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({}),
    }).server(async () => 'data')

    fake.respondWithSequence([
      { toolCalls: [{ id: 'a', name: 'lookup', arguments: {} }] },
      { text: 'final answer' },
    ])

    await agent({ instructions: 's', tools: [lookup] }).prompt('go')

    const stepEvents = captured.filter(e => e.kind === 'agent.step.completed')
    assert.strictEqual(stepEvents.length, 2, 'expected 2 step events for 2 iterations')
    assert.strictEqual(stepEvents[0]!.kind, 'agent.step.completed')
    assert.strictEqual(stepEvents[0]!.iteration, 1)
    assert.strictEqual(stepEvents[1]!.iteration, 2)
    assert.strictEqual(stepEvents[0]!.streaming, false)
    fake.restore()
    unsubscribe?.()
  })

  it('emits step events before agent.completed', async () => {
    const fake = AiFake.fake()
    fake.respondWithSequence([{ text: 'one-shot' }])

    await agent({ instructions: 's' }).prompt('go')

    // step events fire from inside the iteration loop; agent.completed
    // fires after the loop finishes. Order should reflect that.
    const kinds = captured.map(e => e.kind)
    const stepIdx = kinds.indexOf('agent.step.completed')
    const completedIdx = kinds.indexOf('agent.completed')
    assert.ok(stepIdx >= 0 && completedIdx >= 0)
    assert.ok(stepIdx < completedIdx, 'step event must precede completed event')
    fake.restore()
    unsubscribe?.()
  })

  it('streaming variant emits step events with streaming: true', async () => {
    const fake = AiFake.fake()
    fake.respondWithSequence([{ text: 'streamed' }])

    const { stream, response } = agent({ instructions: 's' }).stream('go')
    for await (const _ of stream) { /* drain */ }
    await response

    const stepEvents = captured.filter(e => e.kind === 'agent.step.completed')
    assert.strictEqual(stepEvents.length, 1)
    assert.strictEqual(stepEvents[0]!.streaming, true)
    fake.restore()
    unsubscribe?.()
  })

  it('cumulative tokens field is present on each step event', async () => {
    const fake = AiFake.fake()
    const fetch = toolDefinition({
      name: 'fetch',
      description: 'fetch',
      inputSchema: z.object({}),
    }).server(async () => 'ok')

    fake.respondWithSequence([
      { toolCalls: [{ id: 'a', name: 'fetch', arguments: {} }] },
      { text: 'done' },
    ])

    await agent({ instructions: 's', tools: [fetch] }).prompt('go')

    const stepEvents = captured.filter(e => e.kind === 'agent.step.completed') as Extract<AiEvent, { kind: 'agent.step.completed' }>[]
    assert.strictEqual(stepEvents.length, 2)
    // Shape only — AiFake hard-codes provider usage to 0, so we verify the
    // running-total field is present and shaped correctly. Real providers
    // produce non-zero values; integration coverage lives in playground.
    for (const ev of stepEvents) {
      assert.ok('prompt' in ev.tokens && 'completion' in ev.tokens && 'total' in ev.tokens)
      assert.strictEqual(typeof ev.tokens.total, 'number')
    }
    fake.restore()
    unsubscribe?.()
  })

  it('step event carries the just-completed step shape (with toolCalls)', async () => {
    const fake = AiFake.fake()
    const lookup = toolDefinition({
      name: 'lookup',
      description: 'lookup',
      inputSchema: z.object({}),
    }).server(async () => 'data')

    fake.respondWithSequence([
      { toolCalls: [{ id: 'tc1', name: 'lookup', arguments: {} }] },
      { text: 'final' },
    ])

    await agent({ instructions: 's', tools: [lookup] }).prompt('go')

    const firstStep = captured.find(e => e.kind === 'agent.step.completed') as Extract<AiEvent, { kind: 'agent.step.completed' }> | undefined
    assert.ok(firstStep)
    assert.strictEqual(firstStep.step.toolCalls.length, 1)
    assert.strictEqual(firstStep.step.toolCalls[0]!.id, 'tc1')
    assert.strictEqual(firstStep.step.toolCalls[0]!.name, 'lookup')
    fake.restore()
    unsubscribe?.()
  })
})

describe('parallel tool execution', () => {
  beforeEach(() => installScriptedFake())

  // Each test below issues two tool calls in a single step. The default
  // agent.parallelTools() returns true, so unless overridden the calls
  // run concurrently.

  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  it('default mode runs execute() calls concurrently within a step', async () => {
    // Unified events log so we can verify the concurrency *invariant* — both
    // enters happen before either exit — instead of asserting on the exit
    // ORDER, which is a fragile side-effect of timer ordering (Windows's
    // ~15ms timer quantum + coalescing can flip sleep(10) > sleep(40) under
    // load, even though both tools clearly ran in parallel).
    const events: string[] = []
    const slow = toolDefinition({
      name: 'slow_a',
      description: 'a',
      inputSchema: z.object({}),
    }).server(async () => {
      events.push('a-enter')
      await sleep(40)
      events.push('a-exit')
      return 'a-done'
    })
    const fast = toolDefinition({
      name: 'fast_b',
      description: 'b',
      inputSchema: z.object({}),
    }).server(async () => {
      events.push('b-enter')
      await sleep(10)
      events.push('b-exit')
      return 'b-done'
    })

    _script = [
      { toolCalls: [
        { id: 'pa1', name: 'slow_a', arguments: {} },
        { id: 'pa2', name: 'fast_b', arguments: {} },
      ] },
      { text: 'done' },
    ]

    await agent({ instructions: 'sys', tools: [slow, fast] }).prompt('go')

    // Concurrent execution invariant: both tools entered before either exited.
    // Serial would interleave: ['a-enter', 'a-exit', 'b-enter', 'b-exit'].
    const aEnter = events.indexOf('a-enter')
    const bEnter = events.indexOf('b-enter')
    const aExit  = events.indexOf('a-exit')
    const bExit  = events.indexOf('b-exit')
    assert.ok(aEnter >= 0 && bEnter >= 0 && aExit >= 0 && bExit >= 0, `all four lifecycle events should fire — got ${events.join(' → ')}`)
    assert.ok(Math.max(aEnter, bEnter) < Math.min(aExit, bExit), `concurrent: both enters must precede both exits — got ${events.join(' → ')}`)
    // Tool-call order preserved at the enter boundary — a is first in the batch.
    assert.ok(aEnter < bEnter, `enters must respect tool-call order — got ${events.join(' → ')}`)
  })

  it('parallelTools: false reverts to serial execution', async () => {
    const enters: string[] = []
    const exits: string[] = []
    const slow = toolDefinition({
      name: 'slow_a',
      description: 'a',
      inputSchema: z.object({}),
    }).server(async () => {
      enters.push('a')
      await sleep(20)
      exits.push('a')
      return 'a-done'
    })
    const fast = toolDefinition({
      name: 'fast_b',
      description: 'b',
      inputSchema: z.object({}),
    }).server(async () => {
      enters.push('b')
      await sleep(5)
      exits.push('b')
      return 'b-done'
    })

    _script = [
      { toolCalls: [
        { id: 'ps1', name: 'slow_a', arguments: {} },
        { id: 'ps2', name: 'fast_b', arguments: {} },
      ] },
      { text: 'done' },
    ]

    await agent({ instructions: 'sys', tools: [slow, fast] }).prompt('go', { parallelTools: false })

    // Serial: a fully completes (enter+exit) before b enters.
    assert.deepEqual(enters, ['a', 'b'])
    assert.deepEqual(exits, ['a', 'b'])
  })

  it('agent-level parallelTools() override is honored when no per-call option', async () => {
    const trace: string[] = []
    const agentTools = [
      toolDefinition({ name: 't_a', description: 'a', inputSchema: z.object({}) })
        .server(async () => { trace.push('a-enter'); await sleep(15); trace.push('a-exit'); return 'a' }),
      toolDefinition({ name: 't_b', description: 'b', inputSchema: z.object({}) })
        .server(async () => { trace.push('b-enter'); await sleep(5); trace.push('b-exit'); return 'b' }),
    ]
    class SerialAgent extends Agent {
      parallelTools() { return false }
      instructions() { return 'sys' }
      tools() { return agentTools }
    }

    _script = [
      { toolCalls: [
        { id: 'pa-cls-1', name: 't_a', arguments: {} },
        { id: 'pa-cls-2', name: 't_b', arguments: {} },
      ] },
      { text: 'done' },
    ]

    await new SerialAgent().prompt('go')

    assert.deepEqual(trace, ['a-enter', 'a-exit', 'b-enter', 'b-exit'])
  })

  it('chunk emission preserves tool-call order even when fast tool finishes first', async () => {
    const slow = toolDefinition({
      name: 'streamy_a',
      description: 'a',
      inputSchema: z.object({}),
    }).server(async function* () {
      await sleep(20)
      yield { progress: 'a-1' }
      yield { progress: 'a-2' }
      return 'a-final'
    })
    const fast = toolDefinition({
      name: 'streamy_b',
      description: 'b',
      inputSchema: z.object({}),
    }).server(async function* () {
      yield { progress: 'b-1' }
      return 'b-final'
    })

    _script = [
      { toolCalls: [
        { id: 'po1', name: 'streamy_a', arguments: {} },
        { id: 'po2', name: 'streamy_b', arguments: {} },
      ] },
      { text: 'ok' },
    ]

    const a = agent({ instructions: 'sys', tools: [slow, fast] })
    const { stream, response } = a.stream('go')
    // Filter to only the chunks executeToolPhase emits — tool-update and
    // tool-result. The provider mock also pre-emits tool-call chunks (one
    // per scripted call) before our phase runs, so checking those would
    // conflate provider order with phase order.
    const seq: Array<{ type: string; id: string }> = []
    for await (const chunk of stream) {
      if (chunk.type !== 'tool-update' && chunk.type !== 'tool-result') continue
      const id = chunk.toolCall?.id
      if (!id) continue
      seq.push({ type: chunk.type, id })
    }
    await response

    assert.deepEqual(seq, [
      { type: 'tool-update', id: 'po1' },
      { type: 'tool-update', id: 'po1' },
      { type: 'tool-result', id: 'po1' },
      { type: 'tool-update', id: 'po2' },
      { type: 'tool-result', id: 'po2' },
    ], 'updates + results must emit in tool-call order even when B finishes first')
  })

  it('one tool throwing does not break the sibling tool in the same step', async () => {
    const broken = toolDefinition({
      name: 'broken',
      description: 'throws',
      inputSchema: z.object({}),
    }).server(async (): Promise<string> => { throw new Error('boom') })
    const ok = toolDefinition({
      name: 'ok',
      description: 'ok',
      inputSchema: z.object({}),
    }).server(async () => 'fine')

    _script = [
      { toolCalls: [
        { id: 'pe1', name: 'broken', arguments: {} },
        { id: 'pe2', name: 'ok', arguments: {} },
      ] },
      { text: 'next' },
    ]

    const result = await agent({ instructions: 'sys', tools: [broken, ok] }).prompt('go')

    assert.strictEqual(result.steps[0]!.toolResults.length, 2)
    assert.strictEqual(result.steps[0]!.toolResults[0]!.result, 'Error: boom')
    assert.strictEqual(result.steps[0]!.toolResults[1]!.result, 'fine')
    assert.strictEqual(result.text, 'next')
  })

  it('approval-pending in the batch stops further tool processing', async () => {
    let bExecuted = false
    const ok = toolDefinition({
      name: 'ok_first',
      description: 'a',
      inputSchema: z.object({}),
    }).server(async () => 'first-done')
    const dangerous = toolDefinition({
      name: 'dangerous',
      description: 'needs approval',
      inputSchema: z.object({}),
      needsApproval: true,
    }).server(async () => { bExecuted = true; return 'should not run' })

    _script = [
      { toolCalls: [
        { id: 'pap1', name: 'ok_first', arguments: {} },
        { id: 'pap2', name: 'dangerous', arguments: {} },
      ] },
      { text: 'should-not-be-reached' },
    ]

    const result = await agent({ instructions: 'sys', tools: [ok, dangerous] }).prompt('go')

    assert.strictEqual(result.finishReason, 'tool_approval_required')
    assert.strictEqual(result.pendingApprovalToolCall?.toolCall.id, 'pap2')
    assert.strictEqual(bExecuted, false, 'pending-approval tool must not have executed')
    // The first tool ran and produced its result.
    assert.strictEqual(result.steps[0]!.toolResults.length, 1)
    assert.strictEqual(result.steps[0]!.toolResults[0]!.result, 'first-done')
    // Loop stopped before the next provider call.
    assert.strictEqual(_calls.length, 1)
  })

  it('single-tool batch returns identical behavior in parallel and serial modes', async () => {
    // Sanity check: when parallelism would buy nothing, both paths produce
    // the same chunk sequence and same results.
    function makeTool() {
      return toolDefinition({
        name: 'single',
        description: 's',
        inputSchema: z.object({}),
      }).server(async function* () {
        yield { progress: 1 }
        return 'final'
      })
    }

    const collect = async (parallelTools: boolean) => {
      installScriptedFake()
      _script = [
        { toolCalls: [{ id: 'sb1', name: 'single', arguments: {} }] },
        { text: 'ok' },
      ]
      const types: string[] = []
      const a = agent({ instructions: 'sys', tools: [makeTool()] })
      const { stream, response } = a.stream('go', { parallelTools })
      for await (const chunk of stream) types.push(chunk.type)
      await response
      return types
    }

    const parallel = await collect(true)
    const serial = await collect(false)
    assert.deepEqual(parallel, serial)
  })
})

describe('AiRegistry store on globalThis', () => {
  it('state lives on globalThis so it survives a second copy of @gemstack/ai-sdk', () => {
    // Vite-bundled server apps inline `@gemstack/ai-sdk` (every agent path reads
    // `AiRegistry.resolve(...)`) into entry.mjs, but `AiProvider.boot()`
    // (loaded via `@gemstack/ai-sdk/server`) runs from a node_modules copy
    // resolved via the provider auto-discovery manifest. Without a
    // globalThis-routed store, factories registered from the externalized
    // copy would never be visible to agent resolution from inside the bundle
    // and every call would throw "Unknown AI provider".
    AiRegistry.reset()
    AiRegistry.register(mockFactory)
    AiRegistry.setDefault('mock/some-model')
    const store = (globalThis as Record<string, unknown>)['__rudderjs_ai_registry__'] as {
      factories: Map<string, unknown>
      default:   string | null
      models:    unknown[]
    } | undefined
    assert.ok(store, 'global store should exist after AiRegistry.register()')
    assert.ok(store.factories.has('mock'))
    assert.equal(store.default, 'mock/some-model')
    AiRegistry.reset()
  })
})
