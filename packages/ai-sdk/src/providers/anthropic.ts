import type {
  ProviderFactory,
  ProviderAdapter,
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  FileContent,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
} from '../types.js'
import { base64ToUtf8 } from '../base64.js'

export interface AnthropicConfig {
  apiKey: string
  baseUrl?: string | undefined
}

export class AnthropicProvider implements ProviderFactory {
  readonly name = 'anthropic'
  private readonly config: AnthropicConfig

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new AnthropicAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new AnthropicFileAdapter(this.config)
  }
}

// ─── Adapter ──────────────────────────────────────────────

class AnthropicAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: AnthropicConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ '@anthropic-ai/sdk')
    const Anthropic = sdk.default ?? sdk.Anthropic
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    })
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()
    const { system, messages } = splitSystemMessages(options.messages)
    const cache = options.cache

    const params: Record<string, unknown> = {
      model: this.model,
      messages: applyCacheToMessages(toAnthropicMessages(messages), cache?.messages),
      max_tokens: options.maxTokens ?? 4096,
    }
    const sys = applyCacheToSystem(system, cache?.instructions === true)
    if (sys !== undefined) params['system'] = sys
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop_sequences'] = options.stop
    if (options.tools?.length) {
      params['tools'] = applyCacheToTools(toAnthropicTools(options.tools), cache?.tools === true)
    }
    if (options.toolChoice) params['tool_choice'] = toAnthropicToolChoice(options.toolChoice)

    const response = await client.messages.create(params, options.signal ? { signal: options.signal } : undefined)
    return fromAnthropicResponse(response)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const { system, messages } = splitSystemMessages(options.messages)
    const cache = options.cache

    const params: Record<string, unknown> = {
      model: this.model,
      messages: applyCacheToMessages(toAnthropicMessages(messages), cache?.messages),
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }
    const sys = applyCacheToSystem(system, cache?.instructions === true)
    if (sys !== undefined) params['system'] = sys
    if (options.temperature !== undefined) params['temperature'] = options.temperature
    if (options.topP !== undefined) params['top_p'] = options.topP
    if (options.stop) params['stop_sequences'] = options.stop
    if (options.tools?.length) {
      params['tools'] = applyCacheToTools(toAnthropicTools(options.tools), cache?.tools === true)
    }
    if (options.toolChoice) params['tool_choice'] = toAnthropicToolChoice(options.toolChoice)

    const stream = await client.messages.stream(params, options.signal ? { signal: options.signal } : undefined)

    // Anthropic's stream protocol splits usage across two events:
    //   - `message_start.message.usage.input_tokens` carries the prompt count
    //   - `message_delta.usage.output_tokens` carries the completion count
    // Track the prompt count from message_start so we can emit a complete
    // `finish` usage object — without this the finish chunk reports
    // `promptTokens: 0`, the agent loop's last-wins aggregation overwrites
    // the correct earlier value, and consumers (billing, withBudget) silently
    // undercharge for streamed calls.
    let lastPromptTokens = 0

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text-delta', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool-call-delta', text: event.delta.partial_json }
        }
      } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        yield {
          type: 'tool-call-delta',
          toolCall: { id: event.content_block.id, name: event.content_block.name },
        }
      } else if (event.type === 'message_delta') {
        const completionTokens = event.usage?.output_tokens ?? 0
        yield {
          type: 'finish',
          finishReason: event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
          usage: {
            promptTokens: lastPromptTokens,
            completionTokens,
            totalTokens: lastPromptTokens + completionTokens,
          },
        }
      } else if (event.type === 'message_start' && event.message?.usage) {
        lastPromptTokens = event.message.usage.input_tokens ?? 0
        // output_tokens at message_start is the SDK's initial counter (~0/1),
        // not the final completion total — don't claim a totalTokens here.
        // The `finish` chunk above carries the authoritative final usage.
        yield {
          type: 'usage',
          usage: {
            promptTokens: lastPromptTokens,
            completionTokens: 0,
            totalTokens: lastPromptTokens,
          },
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────

export function splitSystemMessages(messages: AiMessage[]): { system: string | undefined; messages: AiMessage[] } {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.length > 0
    ? systemMsgs.map(m => m.content).join('\n\n')
    : undefined
  return { system, messages: rest }
}

function contentToString(content: string | import('../types.js').ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}

function contentToAnthropicParts(content: string | import('../types.js').ContentPart[]): unknown[] | string {
  if (typeof content === 'string') return content
  return content.map(p => {
    if (p.type === 'text') return { type: 'text', text: p.text }
    if (p.type === 'image') return { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
    // document — use Anthropic's document block for PDFs, else base64
    if (p.mimeType === 'application/pdf') {
      return { type: 'document', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
    }
    // For text-based documents, decode and send as text
    return { type: 'text', text: base64ToUtf8(p.data) }
  })
}

export function toAnthropicMessages(messages: AiMessage[]): unknown[] {
  return messages.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const text = contentToString(m.content)
      return {
        role: 'assistant',
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...m.toolCalls.map(tc => ({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      }
    }
    if (m.role === 'tool') {
      // Tool results come in three shapes today:
      //   - string                — standard scalar return (most tools)
      //   - ContentPart[]         — rich content (e.g. computer-use's screenshot
      //                             returns an image block; the adapter emits it
      //                             as Anthropic's `content: [{ type: 'image', source: {...} }]`)
      //   - any other value       — JSON-stringify fallback (legacy)
      let content: unknown
      if (typeof m.content === 'string') {
        content = m.content
      } else if (Array.isArray(m.content)) {
        content = contentToAnthropicParts(m.content as import('../types.js').ContentPart[])
      } else {
        content = JSON.stringify(m.content)
      }
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: m.toolCallId,
          content,
        }],
      }
    }
    // User messages with attachments → content array
    if (Array.isArray(m.content)) {
      return { role: m.role, content: contentToAnthropicParts(m.content) }
    }
    return { role: m.role, content: m.content }
  })
}

export function toAnthropicTools(tools: ToolDefinitionSchema[]): unknown[] {
  return tools.map(t => {
    // Provider-native tool blocks: when a tool carries a recognized
    // `providerHint`, emit Anthropic's native shape instead of the
    // standard function-call schema. Currently:
    //   - 'computer-use' → computer_20250124 (or whatever `tool` field
    //                       declares; defaults to computer_20250124).
    //                       The model is fine-tuned on the native block;
    //                       quality is dramatically better than wrapping
    //                       it as a function-call.
    if (t.providerHint?.type === 'computer-use') {
      const variant = (t.providerHint['tool'] as string | undefined) ?? 'computer_20250124'
      const width   = (t.providerHint['display_width_px']  as number | undefined) ?? 1280
      const height  = (t.providerHint['display_height_px'] as number | undefined) ?? 800
      return {
        type:              variant,
        name:              t.name,
        display_width_px:  width,
        display_height_px: height,
      }
    }
    //   - 'web-search' → web_search_20250305 (or whatever `tool` field
    //                    declares; defaults to web_search_20250305).
    //                    Server-side; the model emits a `tool_use` block,
    //                    Anthropic runs the search, results stream back as
    //                    a `tool_result` block — no agent-loop round-trip.
    if (t.providerHint?.type === 'web-search') {
      const variant = (t.providerHint['tool'] as string | undefined) ?? 'web_search_20250305'
      const block: Record<string, unknown> = { type: variant, name: t.name }
      if (t.providerHint['max_uses']        !== undefined) block['max_uses']        = t.providerHint['max_uses']
      if (t.providerHint['allowed_domains'] !== undefined) block['allowed_domains'] = t.providerHint['allowed_domains']
      if (t.providerHint['blocked_domains'] !== undefined) block['blocked_domains'] = t.providerHint['blocked_domains']
      if (t.providerHint['user_location']   !== undefined) block['user_location']   = t.providerHint['user_location']
      return block
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }
  })
}

// ─── Prompt-cache markers ────────────────────────────────
//
// Anthropic exposes ephemeral prompt caching via `cache_control` on
// individual content blocks. The marker goes on the *last* block of each
// region you want to cache; everything up to (and including) that block is
// cached. Up to 4 cache breakpoints per request — we currently emit at
// most 3 (system, tools, messages[N]) so we stay well under the limit.
//
// Spec: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

const CACHE_CONTROL = { cache_control: { type: 'ephemeral' as const } }

export function applyCacheToSystem(system: string | undefined, enabled: boolean): unknown {
  if (!system) return undefined
  if (!enabled) return system
  // String-form system can't carry cache_control; convert to a single text block.
  return [{ type: 'text', text: system, ...CACHE_CONTROL }]
}

export function applyCacheToTools(tools: unknown[], enabled: boolean): unknown[] {
  if (!enabled || tools.length === 0) return tools
  return tools.map((t, i) =>
    i === tools.length - 1 ? { ...(t as object), ...CACHE_CONTROL } : t,
  )
}

export function applyCacheToMessages(messages: unknown[], cacheCount: number | undefined): unknown[] {
  if (!cacheCount || cacheCount <= 0 || messages.length === 0) return messages
  // Cache the first N messages — mark cache_control on the last content block
  // of message at index N-1 (or the last actual message if N exceeds length).
  const idx = Math.min(cacheCount - 1, messages.length - 1)
  return messages.map((m, i) => {
    if (i !== idx) return m
    const msg = m as { role: string; content: unknown }
    if (typeof msg.content === 'string') {
      // Convert string content to a single text block so we can attach cache_control.
      return { ...msg, content: [{ type: 'text', text: msg.content, ...CACHE_CONTROL }] }
    }
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const blocks = msg.content as object[]
      const newBlocks = blocks.map((b, j) =>
        j === blocks.length - 1 ? { ...b, ...CACHE_CONTROL } : b,
      )
      return { ...msg, content: newBlocks }
    }
    return m
  })
}

export function toAnthropicToolChoice(choice: ToolChoice): unknown {
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'required') return { type: 'any' }
  if (choice === 'none') return undefined
  if (typeof choice === 'object' && 'name' in choice) return { type: 'tool', name: choice.name }
  return { type: 'auto' }
}

export function fromAnthropicResponse(response: any): ProviderResponse {
  const toolCalls: ToolCall[] = []
  let text = ''

  for (const block of response.content ?? []) {
    if (block.type === 'text') text += block.text
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.input })
    }
  }

  return {
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
    },
    finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
  }
}

// ─── Files ──────────────────────────────────────────────

class AnthropicFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: AnthropicConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ '@anthropic-ai/sdk')
    const Anthropic = sdk.default ?? sdk.Anthropic
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
    })
    return this.client
  }

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises' as string)
    const { basename } = await import(/* @vite-ignore */ 'node:path' as string)
    const data = await readFile(options.filePath)
    const filename = basename(options.filePath)

    const response = await client.files.upload({
      file: new Blob([data]),
      purpose: options.purpose ?? 'assistants',
    })

    return {
      id: response.id,
      filename,
      bytes: data.byteLength,
      purpose: options.purpose,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for await (const f of response) {
      files.push({
        id: f.id,
        filename: f.filename ?? f.id,
        bytes: f.size ?? 0,
        purpose: f.purpose,
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.delete(fileId)
  }

  async retrieve(fileId: string): Promise<FileContent> {
    const client = await this.getClient()
    const response = await client.files.content(fileId)
    const buffer = Buffer.from(await response.arrayBuffer())
    return { data: buffer, mimeType: 'application/octet-stream' }
  }
}
