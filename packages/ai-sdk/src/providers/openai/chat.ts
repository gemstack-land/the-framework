import type {
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  TokenUsage,
  FinishReason,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
} from '../../types.js'
import { base64ToUtf8 } from '../../base64.js'
import { contentToString } from '../../util/content.js'
import type { OpenAIConfig } from './config.js'
import { createOpenAIClient } from './client.js'
import { buildPromptCacheKey } from './prompt-cache.js'

// ─── Adapter (also reused by Ollama) ─────────────────────

export class OpenAIAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: OpenAIConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    this.client = await createOpenAIClient(this.config)
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()

    const messages = toOpenAIMessages(options.messages)
    const tools = options.tools?.length ? toOpenAITools(options.tools) : undefined

    const params: Record<string, unknown> = {
      model: this.model,
      messages,
    }
    if (options.maxTokens) params['max_tokens'] = options.maxTokens
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop'] = options.stop
    if (tools) params['tools'] = tools
    if (options.toolChoice) params['tool_choice'] = toOpenAIToolChoice(options.toolChoice)

    const cacheKey = buildPromptCacheKey(messages, tools, options.cache)
    if (cacheKey) params['prompt_cache_key'] = cacheKey

    const response = await client.chat.completions.create(params, options.signal ? { signal: options.signal } : undefined)
    return fromOpenAIResponse(response)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()

    const messages = toOpenAIMessages(options.messages)
    const tools = options.tools?.length ? toOpenAITools(options.tools) : undefined

    const params: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      // OpenAI omits usage from a streamed completion unless this is set, so
      // without it every streamed call reports nothing to budget accounting.
      stream_options: { include_usage: true },
    }
    if (options.maxTokens) params['max_tokens'] = options.maxTokens
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop'] = options.stop
    if (tools) params['tools'] = tools
    if (options.toolChoice) params['tool_choice'] = toOpenAIToolChoice(options.toolChoice)

    const cacheKey = buildPromptCacheKey(messages, tools, options.cache)
    if (cacheKey) params['prompt_cache_key'] = cacheKey

    const stream = await client.chat.completions.create(params, options.signal ? { signal: options.signal } : undefined)

    let streamUsage: TokenUsage | undefined
    let streamFinishReason: FinishReason | undefined

    for await (const chunk of stream) {
      // The usage-bearing chunk arrives last and carries an empty `choices`
      // array, so it has to be read before the guard below discards it.
      if (chunk.usage) {
        streamUsage = {
          promptTokens:     chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens:      chunk.usage.total_tokens ?? 0,
        }
      }

      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta

      if (delta?.content) {
        yield { type: 'text-delta', text: delta.content }
      }

      if (delta?.tool_calls?.length) {
        for (const tc of delta.tool_calls) {
          // OpenAI guarantees `index` on every tool_calls delta — it's the
          // only stable correlator across the start-delta (carries `id`) and
          // subsequent arg-only deltas. We thread it through StreamChunk so
          // the agent loop can route arg fragments to the right partial
          // under parallel tool calls.
          const index = typeof tc.index === 'number' ? tc.index : undefined
          if (tc.id) {
            yield {
              type: 'tool-call-delta',
              toolCall: { id: tc.id, name: tc.function?.name },
              ...(index !== undefined ? { toolCallIndex: index } : {}),
            }
          }
          if (tc.function?.arguments) {
            yield {
              type: 'tool-call-delta',
              text: tc.function.arguments,
              ...(index !== undefined ? { toolCallIndex: index } : {}),
            }
          }
        }
      }

      if (choice.finish_reason) {
        streamFinishReason = mapOpenAIFinishReason(choice.finish_reason)
      }
    }

    // Emitted after the loop because usage lands on a later chunk than the one
    // carrying `finish_reason`.
    if (streamFinishReason) {
      yield {
        type: 'finish',
        finishReason: streamFinishReason,
        ...(streamUsage ? { usage: streamUsage } : {}),
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────


function contentToOpenAIParts(content: string | import('../../types.js').ContentPart[]): unknown[] | string {
  if (typeof content === 'string') return content
  return content.map(p => {
    if (p.type === 'text') return { type: 'text', text: p.text }
    if (p.type === 'image') return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }
    // document — for text-based docs, decode to text; for PDFs, send as image_url (GPT-4o supports)
    if (p.mimeType === 'application/pdf') {
      return { type: 'file', file: { data: p.data, mime_type: p.mimeType } }
    }
    return { type: 'text', text: base64ToUtf8(p.data) }
  })
}

/**
 * Repair tool-call ↔ tool-result adjacency before serializing for an
 * OpenAI-compatible provider.
 *
 * Anthropic carries tool results as content blocks inside user turns, so a
 * loosely-ordered transcript round-trips fine. The OpenAI wire protocol (and
 * strict implementers like DeepSeek) enforce two hard rules:
 *
 *   1. every `role:'tool'` message must immediately follow the `assistant`
 *      message whose `tool_calls` declares its `tool_call_id`, and
 *   2. every `tool_calls` entry on an assistant message must be answered by a
 *      following `role:'tool'` message before the next assistant/user turn.
 *
 * A persist→resume cycle (client-tool pause, approval round-trip, or an app
 * that re-stores assistant turns without their `toolCalls`) can violate
 * either rule, yielding `400 Messages with role 'tool' must be a response to
 * a preceding message with 'tool_calls'` — or its mirror, an unanswered
 * `tool_calls`. See `docs/plans/2026-06-11-deepseek-tool-transcript-400.md`.
 *
 * This pass enforces BOTH directions:
 *   - **Detached / out-of-order results** are pulled up to sit immediately
 *     after their parent assistant, in `tool_calls` order.
 *   - **Unanswered `tool_calls`** get a synthesized stub result so the
 *     request is well-formed (mirrors the placeholder strategy in
 *     `resumePendingToolCalls`).
 *   - **Orphan tool results** — whose `tool_call_id` is declared by no
 *     assistant message anywhere — are dropped; they can never be valid on
 *     the wire. (Lossy only when the app already discarded the parent's
 *     `toolCalls`; the framework can't reconstruct a deleted call.)
 *
 * Transcripts that already satisfy the invariant pass through unchanged
 * (same message object references), so the common single-run path pays only
 * a linear scan.
 */
export function normalizeToolTranscript(messages: AiMessage[]): AiMessage[] {
  // Index tool results by the call id they answer (a FIFO queue per id
  // tolerates pathological duplicate ids without dropping a message), and
  // collect every call id any assistant message declares.
  const resultsByCallId = new Map<string, AiMessage[]>()
  const declaredCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      const queue = resultsByCallId.get(m.toolCallId)
      if (queue) queue.push(m)
      else resultsByCallId.set(m.toolCallId, [m])
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) declaredCallIds.add(tc.id)
    }
  }

  const out: AiMessage[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push(m)
      // Emit each declared call's answer adjacent + in declaration order,
      // claiming the real result wherever it sat or synthesizing a stub.
      for (const tc of m.toolCalls) {
        const real = resultsByCallId.get(tc.id)?.shift()
        if (real) {
          out.push(real)
        } else {
          out.push({
            role:       'tool',
            toolCallId: tc.id,
            content:    '[ai-sdk] tool result missing — synthesized to satisfy the OpenAI tool-call/tool-result protocol.',
          })
        }
      }
      continue
    }
    // A tool message is emitted only by its parent assistant block above —
    // here it is either already-claimed (skip) or an orphan with no declaring
    // assistant (drop). Either way, never emit it standalone.
    if (m.role === 'tool') continue
    out.push(m)
  }

  return out
}

export function toOpenAIMessages(messages: AiMessage[]): unknown[] {
  return normalizeToolTranscript(messages).map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: contentToString(m.content) || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    }
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }
    }
    // User messages with attachments → content array
    if (Array.isArray(m.content)) {
      return { role: m.role, content: contentToOpenAIParts(m.content) }
    }
    return { role: m.role, content: m.content }
  })
}

export function toOpenAITools(tools: ToolDefinitionSchema[]): unknown[] {
  return tools.map(t => {
    // Provider-native tool blocks: when a tool carries a recognized
    // `providerHint`, emit OpenAI's native shape instead of the standard
    // function-call schema. Currently:
    //   - 'file-search' → { type: 'file_search', vector_store_ids, filters?,
    //                       max_num_results? }. The model is trained on the
    //                       native tool — quality is dramatically better
    //                       than wrapping it as a function call, and the
    //                       provider runs the search server-side so no
    //                       client-side execute is needed.
    if (t.providerHint?.type === 'file-search') {
      const vectorStoreIds = t.providerHint['vector_store_ids'] as string[] | undefined ?? []
      const block: Record<string, unknown> = {
        type:             'file_search',
        vector_store_ids: vectorStoreIds,
      }
      if (t.providerHint['filters']        !== undefined) block['filters']         = t.providerHint['filters']
      if (t.providerHint['max_num_results'] !== undefined) block['max_num_results'] = t.providerHint['max_num_results']
      return block
    }
    return {
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }
  })
}

function toOpenAIToolChoice(choice: ToolChoice): unknown {
  if (choice === 'auto') return 'auto'
  if (choice === 'required') return 'required'
  if (choice === 'none') return 'none'
  if (typeof choice === 'object' && 'name' in choice) return { type: 'function', function: { name: choice.name } }
  return 'auto'
}

function fromOpenAIResponse(response: any): ProviderResponse {
  const choice = response.choices?.[0]
  const message = choice?.message
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }))

  return {
    message: {
      role: 'assistant',
      content: message?.content ?? '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
    finishReason: choice?.finish_reason ? mapOpenAIFinishReason(choice.finish_reason) : 'stop',
  }
}

/**
 * Map an OpenAI finish reason onto the neutral {@link FinishReason}. Without
 * this, a `max_tokens` truncation and a content-filter stop both report a clean
 * `stop`, so a caller cannot tell a complete answer from a cut-off one.
 */
export function mapOpenAIFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls'
    case 'length':          return 'length'
    case 'content_filter':  return 'content_filter'
    default:                return 'stop'
  }
}
