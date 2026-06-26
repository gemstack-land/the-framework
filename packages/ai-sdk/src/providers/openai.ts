import type {
  ProviderFactory,
  ProviderAdapter,
  EmbeddingAdapter,
  EmbeddingResult,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  TextToSpeechAdapter,
  TextToSpeechOptions,
  TextToSpeechResult,
  SpeechToTextAdapter,
  SpeechToTextOptions,
  SpeechToTextResult,
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
  CacheableMarkers,
  VectorStoreAdapter,
  VectorStoreCreateOptions,
  VectorStoreInfo,
  VectorStoreFileInfo,
  VectorStoreAddOptions,
  VectorStoreListOptions,
  VectorStoreList,
  VectorStoreFileList,
} from '../types.js'
import { cyrb53Hex } from '../util/hash.js'
import { base64ToUtf8 } from '../base64.js'

export interface OpenAIConfig {
  apiKey: string
  baseUrl?: string | undefined
  organization?: string | undefined
  /**
   * Extra headers to send with every request. Used by OpenAI-compatible
   * derivatives — OpenRouter sends `HTTP-Referer` and `X-Title` for analytics.
   */
  defaultHeaders?: Record<string, string> | undefined
}

export class OpenAIProvider implements ProviderFactory {
  readonly name = 'openai'
  private readonly config: OpenAIConfig

  constructor(config: OpenAIConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new OpenAIAdapter(this.config, model)
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new OpenAIEmbeddingAdapter(this.config, model)
  }

  createImage(model: string): ImageGenerationAdapter {
    return new OpenAIImageAdapter(this.config, model)
  }

  createTts(model: string): TextToSpeechAdapter {
    return new OpenAITtsAdapter(this.config, model)
  }

  createStt(model: string): SpeechToTextAdapter {
    return new OpenAISttAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new OpenAIFileAdapter(this.config)
  }

  createVectorStores(): VectorStoreAdapter {
    return new OpenAIVectorStoreAdapter(this.config)
  }
}

// ─── Adapter (also reused by Ollama) ─────────────────────

export class OpenAIAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: OpenAIConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
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

    for await (const chunk of stream) {
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
        yield {
          type: 'finish',
          finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
          usage: chunk.usage ? {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          } : undefined,
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────

function contentToString(content: string | import('../types.js').ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}

function contentToOpenAIParts(content: string | import('../types.js').ContentPart[]): unknown[] | string {
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
            content:    '[Rudder] tool result missing — synthesized to satisfy the OpenAI tool-call/tool-result protocol.',
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

// ─── Prompt-cache key ────────────────────────────────────
//
// OpenAI caches prompts automatically once they exceed 1024 tokens. The only
// SDK knob is `prompt_cache_key`: an opaque string that gives OpenAI a routing
// hint so requests with the same cacheable prefix land on the same backend
// (which has the prefix already cached). Stable hashing is the goal — not
// cryptographic strength — so we use cyrb53 over canonical JSON of the
// regions the agent declared as `cacheable()`.
//
// Spec: https://platform.openai.com/docs/guides/prompt-caching

/**
 * Build a stable `prompt_cache_key` from the regions the agent marked as
 * cacheable. Returns `undefined` if no markers apply (request goes out
 * without a cache key — OpenAI still caches automatically above 1024
 * tokens, just without routing affinity).
 *
 * Exported for unit testing.
 */
export function buildPromptCacheKey(
  messages: unknown[],
  tools: unknown[] | undefined,
  cache: CacheableMarkers | undefined,
): string | undefined {
  if (!cache) return undefined

  const parts: unknown[] = []

  if (cache.instructions) {
    const sys = messages.find(m => (m as { role?: string }).role === 'system')
    if (sys) parts.push({ s: (sys as { content: unknown }).content })
  }

  if (cache.tools && tools && tools.length > 0) {
    parts.push({ t: tools })
  }

  if (cache.messages && cache.messages > 0) {
    const conv = messages.filter(m => (m as { role?: string }).role !== 'system')
    const sliced = conv.slice(0, cache.messages)
    if (sliced.length > 0) parts.push({ m: sliced })
  }

  if (parts.length === 0) return undefined

  return cyrb53Hex(JSON.stringify(parts))
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
    finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
  }
}

// ─── Embedding Adapter ────────────────────────────────────

class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1'
    const inputs = Array.isArray(input) ? input : [input]

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.config.organization ? { 'OpenAI-Organization': this.config.organization } : {}),
        ...(this.config.defaultHeaders ?? {}),
      },
      body: JSON.stringify({ model: this.model, input: inputs }),
    })

    if (!res.ok) throw new Error(`[ai-sdk] OpenAI embeddings error: ${res.status} ${await res.text()}`)

    const data = await res.json() as {
      data: { embedding: number[] }[]
      usage: { prompt_tokens: number; total_tokens: number }
    }

    return {
      embeddings: data.data.map(d => d.embedding),
      usage: { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens },
    }
  }
}

// ─── Image Generation Adapter ────────────────────────────

const IMAGE_SIZE_MAP: Record<string, string> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
}

class OpenAIImageAdapter implements ImageGenerationAdapter {
  private client: any = null

  constructor(
    private readonly config: OpenAIConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const client = await this.getClient()

    const size = options.size
      ? (IMAGE_SIZE_MAP[options.size] ?? options.size)
      : '1024x1024'

    const params: Record<string, unknown> = {
      model: this.model,
      prompt: options.prompt,
      size,
      response_format: 'b64_json',
    }
    if (options.n !== undefined) params['n'] = options.n
    if (options.quality) params['quality'] = options.quality
    if (options.style) params['style'] = options.style

    const response = await client.images.generate(params)

    return {
      images: (response.data ?? []).map((img: any) => ({
        ...(img.b64_json ? { base64: img.b64_json } : {}),
        ...(img.url ? { url: img.url } : {}),
        ...(img.revised_prompt ? { revisedPrompt: img.revised_prompt } : {}),
      })),
      model: this.model,
    }
  }
}

// ─── TTS Adapter ─────────────────────────────────────────

class OpenAITtsAdapter implements TextToSpeechAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async generate(options: TextToSpeechOptions): Promise<TextToSpeechResult> {
    const client = await this.getClient()
    const format = options.format ?? 'mp3'

    const params: Record<string, unknown> = {
      model: this.model,
      input: options.text,
      voice: options.voice ?? 'alloy',
    }
    if (options.speed !== undefined) params['speed'] = options.speed
    if (options.format) params['response_format'] = options.format

    const response = await client.audio.speech.create(params)
    const arrayBuffer = await response.arrayBuffer()

    return {
      audio: Buffer.from(arrayBuffer),
      format,
      model: this.model,
    }
  }
}

// ─── STT Adapter ─────────────────────────────────────────

class OpenAISttAdapter implements SpeechToTextAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig, private readonly model: string) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async transcribe(options: SpeechToTextOptions): Promise<SpeechToTextResult> {
    const client = await this.getClient()

    const file = new File([options.audio], 'audio.mp3', { type: 'audio/mpeg' })

    const params: Record<string, unknown> = {
      model: this.model,
      file,
      response_format: 'verbose_json',
    }
    if (options.language) params['language'] = options.language
    if (options.prompt) params['prompt'] = options.prompt

    const response = await client.audio.transcriptions.create(params)

    return {
      text: response.text,
      language: response.language,
      duration: response.duration,
      model: this.model,
    }
  }
}

// ─── Files ──────────────────────────────────────────────

class OpenAIFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { createReadStream } = await import(/* @vite-ignore */ 'node:fs' as string)
    const file = createReadStream(options.filePath)
    const response = await client.files.create({
      file,
      purpose: options.purpose ?? 'assistants',
    })
    return {
      id: response.id,
      filename: response.filename,
      bytes: response.bytes,
      purpose: response.purpose,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for await (const f of response) {
      files.push({
        id: f.id,
        filename: f.filename,
        bytes: f.bytes,
        purpose: f.purpose,
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.del(fileId)
  }

  async retrieve(fileId: string): Promise<FileContent> {
    const client = await this.getClient()
    const response = await client.files.content(fileId)
    const buffer = Buffer.from(await response.arrayBuffer())
    return { data: buffer, mimeType: 'application/octet-stream' }
  }
}

// ─── OpenAI Vector Stores (#B8 Phase 1) ──────────────────

/**
 * OpenAI hosted vector store adapter. Wraps `client.vectorStores.*` and
 * `client.vectorStores.files.*` from the v4+ SDK. Lazy SDK load mirrors
 * the rest of the OpenAI provider.
 *
 * `addFile` defaults to polling until the file is fully indexed
 * (`status === 'completed'`). Pass `{ wait: false }` to fire-and-forget.
 *
 * Local file paths route through OpenAI's Files API first
 * (`client.files.create({ purpose: 'assistants' })`); the resulting
 * `file_id` then attaches to the vector store. Apps that already have
 * a file id pass `{ fileId }` directly.
 */
class OpenAIVectorStoreAdapter implements VectorStoreAdapter {
  private client: any = null

  constructor(private readonly config: OpenAIConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ 'openai')
    const OpenAI = sdk.default ?? sdk.OpenAI
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl ? { baseURL: this.config.baseUrl } : {}),
      ...(this.config.organization ? { organization: this.config.organization } : {}),
      ...(this.config.defaultHeaders ? { defaultHeaders: this.config.defaultHeaders } : {}),
    })
    return this.client
  }

  async create(opts: VectorStoreCreateOptions): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const params: Record<string, unknown> = { name: opts.name }
    if (opts.metadata)     params['metadata']      = opts.metadata
    if (opts.expiresAfter) params['expires_after'] = opts.expiresAfter
    const response = await client.vectorStores.create(params)
    return fromOpenAIVectorStore(response)
  }

  async list(opts?: VectorStoreListOptions): Promise<VectorStoreList> {
    const client = await this.getClient()
    const params: Record<string, unknown> = {}
    if (opts?.limit  !== undefined) params['limit']  = opts.limit
    if (opts?.after  !== undefined) params['after']  = opts.after
    if (opts?.before !== undefined) params['before'] = opts.before
    const response = await client.vectorStores.list(params)
    const data = (response.data ?? []) as unknown[]
    return { stores: data.map(d => fromOpenAIVectorStore(d)) }
  }

  async get(id: string): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const response = await client.vectorStores.retrieve(id)
    return fromOpenAIVectorStore(response)
  }

  async delete(id: string): Promise<void> {
    const client = await this.getClient()
    await client.vectorStores.del(id)
  }

  async addFile(storeId: string, opts: VectorStoreAddOptions): Promise<VectorStoreFileInfo> {
    const client = await this.getClient()

    // Step 1: resolve the file id. If the user passed an existing one we
    // skip the upload; otherwise upload via the standard Files API and
    // reuse the resulting id.
    const fileId = opts.fileId ?? await this.uploadAndGetId(client, opts)

    // Step 2: attach to the store. OpenAI splits attribute + chunking
    // config from the file payload so we pass them as a sibling object.
    const attachParams: Record<string, unknown> = { file_id: fileId }
    if (opts.attributes)        attachParams['attributes']        = opts.attributes
    if (opts.chunkingStrategy)  attachParams['chunking_strategy'] = opts.chunkingStrategy
    const attached = await client.vectorStores.files.create(storeId, attachParams)

    if (opts.wait === false) {
      return fromOpenAIVectorStoreFile(attached, storeId)
    }

    // Step 3: poll until `completed` / `failed` / timeout. Default 2-min
    // budget — enough for typical PDFs but small enough that runaway
    // batch uploads surface a clear error fast.
    const pollInterval = opts.pollInterval ?? 1000
    const pollTimeout  = opts.pollTimeout  ?? 120_000
    const deadline     = Date.now() + pollTimeout

    let current: unknown = attached
    while (true) {
      const info = fromOpenAIVectorStoreFile(current, storeId)
      if (info.status === 'completed' || info.status === 'failed' || info.status === 'cancelled') {
        return info
      }
      if (Date.now() > deadline) {
        throw new Error(
          `[ai-sdk] vector-store file ingestion timed out after ${pollTimeout}ms ` +
          `(store=${storeId}, file=${fileId}, status=${info.status}). ` +
          'Increase pollTimeout or set wait: false for fire-and-forget.',
        )
      }
      await sleep(pollInterval)
      current = await client.vectorStores.files.retrieve(storeId, fileId)
    }
  }

  async removeFile(storeId: string, fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.vectorStores.files.del(storeId, fileId)
  }

  async listFiles(storeId: string, opts?: VectorStoreListOptions): Promise<VectorStoreFileList> {
    const client = await this.getClient()
    const params: Record<string, unknown> = {}
    if (opts?.limit  !== undefined) params['limit']  = opts.limit
    if (opts?.after  !== undefined) params['after']  = opts.after
    if (opts?.before !== undefined) params['before'] = opts.before
    const response = await client.vectorStores.files.list(storeId, params)
    const data = (response.data ?? []) as unknown[]
    return { files: data.map(d => fromOpenAIVectorStoreFile(d, storeId)) }
  }

  /** @internal — upload a local file via the Files API and return the
   *  provider's file id. Used when the user passes `filePath` or
   *  `fileBuffer` to `addFile` instead of an existing `fileId`. */
  private async uploadAndGetId(client: any, opts: VectorStoreAddOptions): Promise<string> {
    if (opts.filePath) {
      const { createReadStream } = await import(/* @vite-ignore */ 'node:fs' as string)
      const file = createReadStream(opts.filePath)
      const uploaded = await client.files.create({ file, purpose: 'assistants' })
      return uploaded.id
    }
    if (opts.fileBuffer) {
      const { toFile } = await import(/* @vite-ignore */ 'openai/uploads' as string) as { toFile: (data: Uint8Array, name: string) => Promise<unknown> }
      const file = await toFile(opts.fileBuffer.data, opts.fileBuffer.filename)
      const uploaded = await client.files.create({ file, purpose: 'assistants' })
      return uploaded.id
    }
    throw new Error(
      '[ai-sdk] addFile requires fileId, filePath, or fileBuffer. ' +
      'Pass an existing OpenAI file id via { fileId } or a local source via { filePath }.',
    )
  }
}

function fromOpenAIVectorStore(raw: unknown): VectorStoreInfo {
  const r = raw as {
    id: string; name: string; created_at: number;
    file_counts?: { total?: number; in_progress?: number; completed?: number; failed?: number; cancelled?: number };
    usage_bytes?: number; metadata?: Record<string, string>;
  }
  const fileCount =
    r.file_counts?.total ??
    (r.file_counts ? (r.file_counts.in_progress ?? 0) + (r.file_counts.completed ?? 0) + (r.file_counts.failed ?? 0) + (r.file_counts.cancelled ?? 0) : 0)
  const result: VectorStoreInfo = {
    id:        r.id,
    name:      r.name,
    createdAt: r.created_at,
    fileCount,
  }
  if (r.usage_bytes !== undefined) result.bytesUsed = r.usage_bytes
  if (r.metadata    !== undefined) result.metadata  = r.metadata
  return result
}

function fromOpenAIVectorStoreFile(raw: unknown, storeId: string): VectorStoreFileInfo {
  const r = raw as {
    id: string; created_at: number; status: string; usage_bytes?: number;
    attributes?: Record<string, string | number | boolean>;
    last_error?: { message: string } | null;
  }
  const status: VectorStoreFileInfo['status'] =
    r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled' || r.status === 'in_progress'
      ? r.status
      : 'in_progress'
  const result: VectorStoreFileInfo = {
    id:            r.id,
    vectorStoreId: storeId,
    status,
    createdAt:     r.created_at,
  }
  if (r.usage_bytes !== undefined)       result.bytes      = r.usage_bytes
  if (r.attributes  !== undefined)       result.attributes = r.attributes
  if (r.last_error?.message !== undefined) result.lastError = r.last_error.message
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
