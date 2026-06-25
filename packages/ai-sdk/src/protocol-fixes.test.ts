// Regression tests for the 2026-05-21 AI protocol/runtime fixes:
//   - Phase 1: Gemini `functionResponse.name` carries the function name, not the call id
//   - Phase 3: `contentTo*Parts` paths work without `Buffer` (browser/RN/Electron renderer)
//   - Phase 4: `AI.embed({ cache: true })` actually caches across calls

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { toGeminiContents } from './providers/google.js'
import { toAnthropicMessages } from './providers/anthropic.js'
import { toOpenAIMessages, normalizeToolTranscript } from './providers/openai.js'
import { base64ToUtf8 } from './base64.js'
import { AI } from './facade.js'
import { AiRegistry } from './registry.js'
import type { AiMessage, EmbeddingAdapter, EmbeddingResult, ProviderFactory } from './types.js'

// ─── Phase 1: Gemini functionResponse.name ─────────────────

describe('Gemini protocol — functionResponse.name', () => {
  it('uses the originating function name, not the synthetic call id', () => {
    const messages: AiMessage[] = [
      { role: 'user', content: 'find rust crates' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1234_abc', name: 'search', arguments: { q: 'rust' } }],
      },
      { role: 'tool', toolCallId: 'call_1234_abc', content: '[results]' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolPart = (contents[contents.length - 1] as { parts: { functionResponse: { name: string } }[] }).parts[0]!
    assert.strictEqual(toolPart.functionResponse.name, 'search')
  })

  it('routes results back to the right function when multiple parallel tools were called', () => {
    const messages: AiMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_a', name: 'search', arguments: { q: 'x' } },
          { id: 'call_b', name: 'fetch',  arguments: { url: 'y' } },
        ],
      },
      { role: 'tool', toolCallId: 'call_b', content: '[fetched]' },
      { role: 'tool', toolCallId: 'call_a', content: '[searched]' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolParts = (contents.slice(-2) as { parts: { functionResponse: { name: string; response: unknown } }[] }[])
      .map(c => c.parts[0]!.functionResponse)
    assert.strictEqual(toolParts[0]!.name, 'fetch')
    assert.strictEqual(toolParts[1]!.name, 'search')
  })

  it('falls back to "unknown" when no prior assistant message carries the call id', () => {
    // Defensive — if the host hands us a tool message in isolation (e.g. a
    // replayed fixture missing the assistant turn) we still emit a well-formed
    // functionResponse rather than crashing.
    const messages: AiMessage[] = [
      { role: 'tool', toolCallId: 'orphan', content: 'x' },
    ]
    const { contents } = toGeminiContents(messages)
    const toolPart = (contents[0] as { parts: { functionResponse: { name: string } }[] }).parts[0]!
    assert.strictEqual(toolPart.functionResponse.name, 'unknown')
  })
})

// ─── Phase 3: contentTo*Parts paths run without Buffer ─────

describe('Buffer-free runtime — contentTo*Parts text-document decoding', () => {
  // `\u{1F44B}` (waving hand) is multi-byte UTF-8 — exercises the TextDecoder
  // path beyond ASCII and would silently corrupt under a naive
  // `String.fromCharCode` chain.
  const utf8Sample = 'hi \u{1F44B} world'
  const base64 = (() => {
    if (typeof Buffer !== 'undefined') return Buffer.from(utf8Sample, 'utf8').toString('base64')
    const bytes = new TextEncoder().encode(utf8Sample)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  })()

  // Stash `Buffer` for the suite — restore after, so other tests still get it.
  let savedBuffer: unknown
  beforeEach(() => {
    savedBuffer = (globalThis as { Buffer?: unknown }).Buffer
    delete (globalThis as { Buffer?: unknown }).Buffer
  })
  afterEach(() => {
    if (savedBuffer !== undefined) (globalThis as Record<string, unknown>)['Buffer'] = savedBuffer
  })

  it('base64ToUtf8 round-trips without a Buffer global', () => {
    assert.strictEqual(base64ToUtf8(base64), utf8Sample)
  })

  it('Gemini text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const { contents } = toGeminiContents(messages)
    const part = (contents[0] as { parts: { text: string }[] }).parts[0]!
    assert.strictEqual(part.text, utf8Sample)
  })

  it('Anthropic text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const result = toAnthropicMessages(messages) as { content: { type: string; text: string }[] }[]
    const part = result[0]!.content[0]!
    assert.strictEqual(part.type, 'text')
    assert.strictEqual(part.text, utf8Sample)
  })

  it('OpenAI text-document part decodes without Buffer', () => {
    const messages: AiMessage[] = [{
      role: 'user',
      content: [{ type: 'document', data: base64, mimeType: 'text/plain' }],
    }]
    const result = toOpenAIMessages(messages) as { content: { type: string; text: string }[] }[]
    const part = result[0]!.content[0]!
    assert.strictEqual(part.type, 'text')
    assert.strictEqual(part.text, utf8Sample)
  })
})

// ─── Phase 4: AI.embed({ cache: true }) actually caches ────

describe('AI.embed cache keying', () => {
  let networkCalls: number
  let factory: ProviderFactory

  beforeEach(() => {
    AiRegistry.reset()
    networkCalls = 0
    const adapter: EmbeddingAdapter = {
      async embed(input: string | string[]): Promise<EmbeddingResult> {
        networkCalls++
        const items = Array.isArray(input) ? input : [input]
        return {
          embeddings: items.map(() => [0.1, 0.2, 0.3]),
          usage: { promptTokens: items.length, totalTokens: items.length },
        }
      },
    }
    factory = {
      name: 'fake-embed',
      create: () => { throw new Error('not implemented for embedding tests') },
      // A fresh inner adapter on every call — the bug we're fixing.
      createEmbedding: () => ({ ...adapter }),
    }
    AiRegistry.register(factory)
  })

  afterEach(() => AiRegistry.reset())

  it('cache: true hits the cache on the second identical call', async () => {
    const a = await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    const b = await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.deepStrictEqual(a.embeddings, b.embeddings)
    assert.strictEqual(networkCalls, 1, 'second call should hit cache, not the wire')
  })

  it('cache: false makes a fresh wire call every time', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1' })
    await AI.embed('hello', { model: 'fake-embed/m1' })
    assert.strictEqual(networkCalls, 2)
  })

  it('different models do not share cache state', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    await AI.embed('hello', { model: 'fake-embed/m2', cache: true })
    assert.strictEqual(networkCalls, 2)
  })

  it('AiRegistry.reset() clears the embedding cache so stale fakes do not leak', async () => {
    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.strictEqual(networkCalls, 1)

    AiRegistry.reset()
    AiRegistry.register(factory)
    networkCalls = 0

    await AI.embed('hello', { model: 'fake-embed/m1', cache: true })
    assert.strictEqual(networkCalls, 1, 'post-reset call must hit the new adapter, not the cached one')
  })
})

// ─── DeepSeek / OpenAI-compatible: tool-call ↔ tool-result adjacency ──
// Regression for `400 Messages with role 'tool' must be a response to a
// preceding message with 'tool_calls'` on DeepSeek and other strict
// OpenAI-protocol providers. Anthropic tolerates loose ordering; OpenAI does
// not. See docs/plans/2026-06-11-deepseek-tool-transcript-400.md.

type OpenAIMsg = {
  role:        string
  content?:    unknown
  tool_call_id?: string
  tool_calls?: { id: string }[]
}

/**
 * Assert the serialized OpenAI `messages` array satisfies BOTH protocol
 * rules: every `tool` message follows its parent `assistant`+`tool_calls`,
 * and every declared `tool_calls` id is answered before the next turn.
 */
function assertOpenAIToolInvariant(messages: OpenAIMsg[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue
    // Every declared id must be answered by a contiguous run of tool messages.
    const expected = m.tool_calls.map(tc => tc.id)
    const answered: string[] = []
    let j = i + 1
    while (j < messages.length && messages[j]!.role === 'tool') {
      answered.push(messages[j]!.tool_call_id!)
      j++
    }
    assert.deepStrictEqual(
      answered.slice(0, expected.length),
      expected,
      `assistant at ${i} must be immediately followed by tool results for ${expected.join(', ')}`,
    )
  }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!
    if (m.role !== 'tool') continue
    // Walk back over the contiguous tool run; the message before it must be
    // an assistant whose tool_calls declares this id.
    let k = i
    while (k > 0 && messages[k - 1]!.role === 'tool') k--
    const parent = messages[k - 1]
    assert.ok(
      parent && parent.role === 'assistant' && parent.tool_calls?.some(tc => tc.id === m.tool_call_id),
      `tool message at ${i} (${m.tool_call_id}) must follow an assistant declaring it`,
    )
  }
}

describe('OpenAI tool transcript normalization', () => {
  it('drops an orphan tool result with no preceding tool_calls (the DeepSeek 400)', () => {
    const messages: AiMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'edit the form' },
      { role: 'assistant', content: 'Done.' },           // toolCalls dropped by the app
      { role: 'tool', content: '{"ok":true}', toolCallId: 'call_x' },
    ]
    const normalized = normalizeToolTranscript(messages)
    assert.ok(!normalized.some(m => m.role === 'tool'), 'orphan tool result is dropped')
    assertOpenAIToolInvariant(toOpenAIMessages(messages) as OpenAIMsg[])
  })

  it('pulls a detached tool result back adjacent to its parent assistant', () => {
    const messages: AiMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 't', arguments: {} }] },
      { role: 'assistant', content: 'interjected summary' },   // wrongly between call + result
      { role: 'tool', content: 'result-a', toolCallId: 'a' },
    ]
    const out = toOpenAIMessages(messages) as OpenAIMsg[]
    assertOpenAIToolInvariant(out)
    // The result now sits immediately after its parent; the stray assistant trails.
    const parentIdx = out.findIndex(m => m.role === 'assistant' && m.tool_calls?.length)
    assert.strictEqual(out[parentIdx + 1]!.role, 'tool')
    assert.strictEqual(out[parentIdx + 1]!.tool_call_id, 'a')
  })

  it('synthesizes a stub for an unanswered tool_call (reverse direction)', () => {
    const messages: AiMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a', name: 't', arguments: {} },
        { id: 'b', name: 't', arguments: {} },
      ] },
      { role: 'tool', content: 'result-a', toolCallId: 'a' },   // b never answered
    ]
    const out = toOpenAIMessages(messages) as OpenAIMsg[]
    assertOpenAIToolInvariant(out)
    const toolMsgs = out.filter(m => m.role === 'tool')
    assert.strictEqual(toolMsgs.length, 2, 'both calls answered after repair')
    const stub = toolMsgs.find(m => m.tool_call_id === 'b')!
    assert.match(String(stub.content), /tool result missing/)
  })

  it('preserves a well-formed parallel transcript unchanged', () => {
    const messages: AiMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a', name: 't', arguments: {} },
        { id: 'b', name: 't', arguments: {} },
      ] },
      { role: 'tool', content: 'ra', toolCallId: 'a' },
      { role: 'tool', content: 'rb', toolCallId: 'b' },
      { role: 'assistant', content: 'summary' },
    ]
    const normalized = normalizeToolTranscript(messages)
    assert.deepStrictEqual(
      normalized.map(m => ({ role: m.role, id: m.toolCallId })),
      messages.map(m => ({ role: m.role, id: m.toolCallId })),
      'already-valid transcript is a no-op',
    )
    assertOpenAIToolInvariant(toOpenAIMessages(messages) as OpenAIMsg[])
  })

  it('repairs a two-call client-tool apply through a pause/resume cycle', () => {
    // Simulates the pilotiq-pro repro: two field edits via a client tool, then
    // the wrap-up call carries both results back — but persistence reordered
    // them and one landed after an assistant interjection.
    const messages: AiMessage[] = [
      { role: 'user', content: 'set name and email' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'c1', name: 'update_form_state', arguments: { field: 'name' } },
        { id: 'c2', name: 'update_form_state', arguments: { field: 'email' } },
      ] },
      { role: 'tool', content: '{"applied":true}', toolCallId: 'c2' },   // out of order
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', content: '{"applied":true}', toolCallId: 'c1' },
    ]
    assertOpenAIToolInvariant(toOpenAIMessages(messages) as OpenAIMsg[])
  })
})
