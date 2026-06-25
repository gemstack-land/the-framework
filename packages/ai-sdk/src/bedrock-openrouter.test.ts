import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AiRegistry } from './registry.js'
import { OpenRouterProvider } from './providers/openrouter.js'
import { BedrockProvider, isAnthropicOnBedrock, mapBedrockAnthropicEvent, type BedrockStreamState } from './providers/bedrock.js'
import { OpenAIAdapter } from './providers/openai.js'

// ─── OpenRouter ───────────────────────────────────────────

describe('OpenRouterProvider', () => {
  it('exposes provider name "openrouter"', () => {
    const p = new OpenRouterProvider({ apiKey: 'sk-or-test' })
    assert.equal(p.name, 'openrouter')
  })

  it('returns an OpenAI-compatible adapter', () => {
    const p = new OpenRouterProvider({ apiKey: 'sk-or-test' })
    const adapter = p.create('anthropic/claude-3.5-sonnet')
    assert.ok(adapter instanceof OpenAIAdapter)
  })

  it('parses OpenRouter model strings (one slash split)', () => {
    AiRegistry.reset()
    AiRegistry.register(new OpenRouterProvider({ apiKey: 'sk-or-test' }))
    // After parsing, provider='openrouter', model='anthropic/claude-3.5-sonnet'
    const adapter = AiRegistry.resolve('openrouter/anthropic/claude-3.5-sonnet')
    assert.ok(adapter instanceof OpenAIAdapter)
  })

  it('passes site headers through OpenAIConfig.defaultHeaders', () => {
    const p = new OpenRouterProvider({
      apiKey: 'sk-or-test',
      siteUrl: 'https://example.com',
      siteName: 'Example',
    })
    const adapter = p.create('openai/gpt-4o') as OpenAIAdapter
    // Inspect the private config via the adapter — readonly field on the class.
    const cfg = (adapter as unknown as { config: { defaultHeaders?: Record<string, string> } }).config
    assert.deepEqual(cfg.defaultHeaders, {
      'HTTP-Referer': 'https://example.com',
      'X-Title': 'Example',
    })
  })

  it('omits defaultHeaders when no site info is provided', () => {
    const p = new OpenRouterProvider({ apiKey: 'sk-or-test' })
    const adapter = p.create('openai/gpt-4o') as OpenAIAdapter
    const cfg = (adapter as unknown as { config: { defaultHeaders?: Record<string, string> } }).config
    assert.equal(cfg.defaultHeaders, undefined)
  })

  it('uses default OpenRouter base URL when not overridden', () => {
    const p = new OpenRouterProvider({ apiKey: 'sk-or-test' })
    const adapter = p.create('openai/gpt-4o') as OpenAIAdapter
    const cfg = (adapter as unknown as { config: { baseUrl: string } }).config
    assert.equal(cfg.baseUrl, 'https://openrouter.ai/api/v1')
  })

  it('honors a custom baseUrl override', () => {
    const p = new OpenRouterProvider({ apiKey: 'sk-or-test', baseUrl: 'https://proxy.example.com/v1' })
    const adapter = p.create('openai/gpt-4o') as OpenAIAdapter
    const cfg = (adapter as unknown as { config: { baseUrl: string } }).config
    assert.equal(cfg.baseUrl, 'https://proxy.example.com/v1')
  })
})

// ─── Bedrock ──────────────────────────────────────────────

describe('BedrockProvider', () => {
  it('exposes provider name "bedrock"', () => {
    const p = new BedrockProvider({ region: 'us-east-1' })
    assert.equal(p.name, 'bedrock')
  })

  it('creates an adapter for Anthropic Claude on Bedrock', () => {
    const p = new BedrockProvider({ region: 'us-east-1' })
    const adapter = p.create('anthropic.claude-3-5-sonnet-20241022-v2:0')
    assert.ok(adapter)
    assert.equal(typeof adapter.generate, 'function')
    assert.equal(typeof adapter.stream, 'function')
  })

  it('throws a clear error for unsupported model families', () => {
    const p = new BedrockProvider({ region: 'us-east-1' })
    assert.throws(
      () => p.create('meta.llama-3-70b-instruct-v1:0'),
      /v1 only supports Anthropic Claude models on Bedrock/,
    )
  })

  it('parses Bedrock model strings with colons + dots intact', () => {
    AiRegistry.reset()
    AiRegistry.register(new BedrockProvider({ region: 'us-east-1' }))
    const adapter = AiRegistry.resolve('bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0')
    assert.ok(adapter)
  })
})

// ─── isAnthropicOnBedrock ─────────────────────────────────

describe('isAnthropicOnBedrock', () => {
  it('matches anthropic-prefixed model ids', () => {
    assert.equal(isAnthropicOnBedrock('anthropic.claude-3-5-sonnet-20241022-v2:0'), true)
    assert.equal(isAnthropicOnBedrock('anthropic.claude-3-5-haiku-20241022-v1:0'), true)
  })

  it('matches regional cross-region inference profiles', () => {
    assert.equal(isAnthropicOnBedrock('us.anthropic.claude-3-5-sonnet-20241022-v2:0'), true)
    assert.equal(isAnthropicOnBedrock('eu.anthropic.claude-3-5-sonnet-20241022-v2:0'), true)
    assert.equal(isAnthropicOnBedrock('apac.anthropic.claude-3-5-sonnet-20241022-v2:0'), true)
  })

  it('rejects other model families', () => {
    assert.equal(isAnthropicOnBedrock('meta.llama-3-70b-instruct-v1:0'), false)
    assert.equal(isAnthropicOnBedrock('amazon.nova-pro-v1:0'), false)
    assert.equal(isAnthropicOnBedrock('cohere.command-r-plus-v1:0'), false)
    assert.equal(isAnthropicOnBedrock('mistral.mistral-large-2402-v1:0'), false)
  })
})

// ─── mapBedrockAnthropicEvent ─────────────────────────────

describe('mapBedrockAnthropicEvent', () => {
  const newState = (): BedrockStreamState => ({ lastPromptTokens: 0 })

  it('maps text-delta events', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    }, newState())]
    assert.deepEqual(chunks, [{ type: 'text-delta', text: 'Hello' }])
  })

  it('maps tool_use start to tool-call-delta', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'content_block_start',
      content_block: { type: 'tool_use', id: 'tu_123', name: 'getWeather' },
    }, newState())]
    assert.deepEqual(chunks, [{
      type: 'tool-call-delta',
      toolCall: { id: 'tu_123', name: 'getWeather' },
    }])
  })

  it('maps input_json_delta to tool-call-delta with text', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'content_block_delta',
      delta: { type: 'input_json_delta', partial_json: '{"city":"' },
    }, newState())]
    assert.deepEqual(chunks, [{ type: 'tool-call-delta', text: '{"city":"' }])
  })

  it('maps message_delta with tool_use stop reason', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 12 },
    }, newState())]
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0]!.type, 'finish')
    assert.equal((chunks[0] as { finishReason: string }).finishReason, 'tool_calls')
  })

  it('maps message_delta with end_turn stop reason', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 5 },
    }, newState())]
    assert.equal((chunks[0] as { finishReason: string }).finishReason, 'stop')
  })

  it('maps message_start to a usage chunk', () => {
    const chunks = [...mapBedrockAnthropicEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 100, output_tokens: 0 } },
    }, newState())]
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0]!.type, 'usage')
    assert.equal((chunks[0] as { usage: { promptTokens: number } }).usage.promptTokens, 100)
  })

  it('emits nothing for unknown event types', () => {
    const chunks = [...mapBedrockAnthropicEvent({ type: 'ping' }, newState())]
    assert.equal(chunks.length, 0)
  })

  // ─── Regression: prompt-token clobber on streaming ────────
  //
  // Anthropic's stream protocol splits prompt + completion counts across two
  // events. Before #545's sibling fix here, message_delta emitted
  // promptTokens: 0 on the `finish` chunk, the agent loop's last-wins
  // aggregation overwrote the correct value from message_start, and consumers
  // (billing, withBudget) silently undercharged. Bedrock-Anthropic uses the
  // identical protocol so it had the identical bug.

  it('threads promptTokens from message_start into the finish chunk', () => {
    const state = newState()
    const startChunks = [...mapBedrockAnthropicEvent({
      type: 'message_start',
      message: { usage: { input_tokens: 100, output_tokens: 0 } },
    }, state)]
    const deltaChunks = [...mapBedrockAnthropicEvent({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 42 },
    }, state)]

    // message_start carries the prompt count
    const usageChunk = startChunks[0] as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
    assert.equal(usageChunk.usage.promptTokens, 100)
    // completionTokens at message_start is the SDK's initial counter, not
    // the final count — must not claim a totalTokens that mixes them.
    assert.equal(usageChunk.usage.completionTokens, 0)
    assert.equal(usageChunk.usage.totalTokens, 100)

    // message_delta — the regression fix: promptTokens MUST carry over from
    // state.lastPromptTokens, not reset to 0.
    const finishChunk = deltaChunks[0] as { usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
    assert.equal(finishChunk.usage.promptTokens, 100, 'finish chunk should report promptTokens from message_start')
    assert.equal(finishChunk.usage.completionTokens, 42)
    assert.equal(finishChunk.usage.totalTokens, 142)
  })
})
