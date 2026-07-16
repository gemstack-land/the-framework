import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
  EmbeddingAdapter,
  EmbeddingResult,
  ImageGenerationAdapter,
  ImageGenerationOptions,
  ImageGenerationResult,
  FileAdapter,
  FileUploadOptions,
  FileUploadResult,
  FileListResult,
  VectorStoreAdapter,
  VectorStoreCreateOptions,
  VectorStoreInfo,
  VectorStoreFileInfo,
  VectorStoreAddOptions,
  VectorStoreListOptions,
  VectorStoreList,
  VectorStoreFileList,
} from '../types.js'
import type { FileSearchFilter } from '../file-search.js'
import { base64ToUtf8 } from '../base64.js'
import {
  GoogleCacheRegistry,
  buildGoogleCacheKey,
  splitContentsAtCache,
  durationToGoogleTtl,
  _internals as _registryInternals,
} from './google-cache-registry.js'
import { contentToString } from '../util/content.js'

export interface GoogleConfig {
  apiKey: string
}

export class GoogleProvider implements ProviderFactory {
  readonly name = 'google'
  private readonly config: GoogleConfig
  private readonly cacheRegistry?: GoogleCacheRegistry

  constructor(config: GoogleConfig, cacheRegistry?: GoogleCacheRegistry) {
    this.config = config
    if (cacheRegistry) this.cacheRegistry = cacheRegistry
  }

  create(model: string): ProviderAdapter {
    return new GoogleAdapter(this.config, model, this.cacheRegistry)
  }

  createEmbedding(model: string): EmbeddingAdapter {
    return new GoogleEmbeddingAdapter(this.config, model)
  }

  createImage(model: string): ImageGenerationAdapter {
    return new GoogleImageAdapter(this.config, model)
  }

  createFiles(): FileAdapter {
    return new GoogleFileAdapter(this.config)
  }

  createVectorStores(): VectorStoreAdapter {
    return new GoogleVectorStoreAdapter(this.config)
  }
}

// ─── Adapter ──────────────────────────────────────────────

export class GoogleAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
    private readonly cacheRegistry?: GoogleCacheRegistry | undefined,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  /**
   * Build the request payload, consulting the cache registry if `options.cache`
   * is set. Returns the payload for `generateContent` / `generateContentStream`
   * plus the cache key (so the caller can `forget()` it on a 404 stale-cache
   * retry).
   */
  private async buildPayload(
    options: ProviderRequestOptions,
  ): Promise<{ payload: Record<string, unknown>; cacheKey: string | undefined }> {
    const client = await this.getClient()
    const { system, contents } = toGeminiContents(options.messages)
    // `toGeminiTools` returns the already-wrapped top-level array
    // ({functionDeclarations: [...]} + any native blocks like google_search).
    const geminiTools = options.tools?.length ? toGeminiTools(options.tools) : undefined

    const config: Record<string, unknown> = {}
    if (options.maxTokens) config['maxOutputTokens'] = options.maxTokens
    if (options.temperature !== undefined) config['temperature'] = options.temperature
    if (options.topP !== undefined) config['topP'] = options.topP
    if (options.stop) config['stopSequences'] = options.stop
    if (geminiTools && geminiTools.length > 0) config['tools'] = geminiTools
    if (options.toolChoice) config['toolConfig'] = toGeminiToolConfig(options.toolChoice)
    // The Gemini SDK reads abortSignal from the config block.
    if (options.signal) config['abortSignal'] = options.signal

    let cacheName: string | null = null
    let cacheKey: string | undefined
    if (this.cacheRegistry && options.cache) {
      cacheKey = buildGoogleCacheKey(this.model, options.cache, system, contents, geminiTools)
      if (cacheKey) {
        const { cached: cachedSlice } = splitContentsAtCache(contents, options.cache)
        cacheName = await this.cacheRegistry.resolve({
          client,
          model:    this.model,
          cacheKey,
          ...(options.cache.instructions && system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          ...(cachedSlice.length > 0 ? { contents: cachedSlice } : {}),
          ...(options.cache.tools && geminiTools && geminiTools.length > 0 ? { tools: geminiTools } : {}),
          ...(options.cache.ttl ? { ttl: durationToGoogleTtl(options.cache.ttl) } : {}),
        })
      }
    }

    if (cacheName) {
      // Drop tools / system from the request — they're inherited from the cache resource.
      const { fresh } = splitContentsAtCache(contents, options.cache)
      const configForCachedRequest: Record<string, unknown> = { ...config }
      delete configForCachedRequest['tools']
      configForCachedRequest['cachedContent'] = cacheName
      return {
        payload: { model: this.model, contents: fresh, config: configForCachedRequest },
        cacheKey,
      }
    }

    return {
      payload: {
        model: this.model,
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        config,
      },
      cacheKey,
    }
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const { payload, cacheKey } = await this.buildPayload(options)
    const client = await this.getClient()

    try {
      const response = await client.models.generateContent(payload)
      return fromGeminiResponse(response)
    } catch (err) {
      if (cacheKey && this.cacheRegistry && _registryInternals.isNotFoundError(err)) {
        // Stale `cachedContent` resource — drop and retry once with a fresh build.
        await this.cacheRegistry.forget(cacheKey)
        const { payload: retryPayload } = await this.buildPayload(options)
        const response = await client.models.generateContent(retryPayload)
        return fromGeminiResponse(response)
      }
      throw err
    }
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    let payloadAndKey = await this.buildPayload(options)
    const client = await this.getClient()

    let response: AsyncIterable<any>
    try {
      response = await client.models.generateContentStream(payloadAndKey.payload)
    } catch (err) {
      if (payloadAndKey.cacheKey && this.cacheRegistry && _registryInternals.isNotFoundError(err)) {
        await this.cacheRegistry.forget(payloadAndKey.cacheKey)
        payloadAndKey = await this.buildPayload(options)
        response = await client.models.generateContentStream(payloadAndKey.payload)
      } else {
        throw err
      }
    }

    for await (const chunk of response) {
      const candidate = chunk.candidates?.[0]
      if (!candidate) continue

      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          yield { type: 'text-delta', text: part.text }
        }
        if (part.functionCall) {
          yield {
            type: 'tool-call',
            toolCall: {
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args ?? {},
            },
          }
        }
      }

      if (candidate.finishReason) {
        yield {
          type: 'finish',
          finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'tool_calls',
          usage: chunk.usageMetadata ? {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          } : undefined,
        }
      }
    }
  }
}

// ─── Conversion Helpers ──────────────────────────────────


function contentToGeminiParts(content: string | import('../types.js').ContentPart[]): unknown[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map(p => {
    if (p.type === 'text') return { text: p.text }
    if (p.type === 'image') return { inlineData: { mimeType: p.mimeType, data: p.data } }
    // document — inline data for PDFs, text for text-based
    if (p.mimeType === 'application/pdf') {
      return { inlineData: { mimeType: p.mimeType, data: p.data } }
    }
    return { text: base64ToUtf8(p.data) }
  })
}

export function toGeminiContents(messages: AiMessage[]): { system: string | undefined; contents: unknown[] } {
  const systemMsgs = messages.filter(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const system = systemMsgs.length > 0
    ? systemMsgs.map(m => contentToString(m.content)).join('\n\n')
    : undefined

  // Gemini's `functionResponse.name` must match the originating `functionCall.name`
  // (the function name like "search"), not the synthetic call id the adapter
  // generates per stream. Pre-build a (toolCallId → name) lookup by walking
  // every prior assistant message's `toolCalls`. Without this the receiving
  // model sees `name: "call_1234_abc"` and can't pair the result with the call.
  const toolNameByCallId = new Map<string, string>()
  for (const m of rest) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) toolNameByCallId.set(tc.id, tc.name)
    }
  }

  const contents = rest.map(m => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const text = contentToString(m.content)
      return {
        role: 'model',
        parts: [
          ...(text ? [{ text }] : []),
          ...m.toolCalls.map(tc => ({
            functionCall: { name: tc.name, args: tc.arguments },
          })),
        ],
      }
    }
    if (m.role === 'tool') {
      const callId = m.toolCallId
      const name = (callId && toolNameByCallId.get(callId)) ?? 'unknown'
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name,
            response: typeof m.content === 'string' ? { result: m.content } : m.content,
          },
        }],
      }
    }
    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: contentToGeminiParts(m.content),
    }
  })

  return { system, contents }
}

/**
 * Build Gemini's `tools` array. The Gemini API accepts a mixed array where
 * function declarations live under one wrapper entry and provider-native
 * blocks (e.g. `{ google_search: {} }`) sit as separate top-level entries:
 *
 *   tools: [
 *     { functionDeclarations: [...] },
 *     { google_search: {} },
 *   ]
 *
 * Tools tagged with a recognized `providerHint.type` are emitted as their
 * native top-level block; everything else collects into one
 * `functionDeclarations` entry. Tools with unrecognized hints fall through
 * to the function-declaration shape — the input schema's still there, so
 * the worst case is the model treats it as a regular function-call tool.
 */
function toGeminiTools(tools: ToolDefinitionSchema[]): unknown[] {
  const fnDecls: unknown[] = []
  const blocks:  unknown[] = []
  for (const t of tools) {
    if (t.providerHint?.type === 'web-search') {
      // Gemini's native search tool. The block's `google_search: {}` form is
      // intentional — Gemini doesn't accept allowed_domains / max_uses on
      // this block, so the WebSearch.domains() / .maxResults() opts are
      // ignored on this provider (documented on WebSearch).
      blocks.push({ google_search: {} })
      continue
    }
    if (t.providerHint?.type === 'file-search') {
      // Gemini's native FileSearch tool (#B8.5). The OpenAI-shaped hint
      // (`vector_store_ids` + typed `filters`) is translated to Gemini's
      // shape (`fileSearchStoreNames` + `metadataFilter` string). `topK`
      // mirrors OpenAI's `max_num_results`.
      const storeNames = (t.providerHint['vector_store_ids'] as string[] | undefined) ?? []
      const fileSearchConfig: Record<string, unknown> = {
        fileSearchStoreNames: storeNames,
      }
      const filters = t.providerHint['filters'] as FileSearchFilter | undefined
      if (filters !== undefined) {
        fileSearchConfig['metadataFilter'] = filterToGeminiString(filters)
      }
      const maxNumResults = t.providerHint['max_num_results']
      if (maxNumResults !== undefined) {
        fileSearchConfig['topK'] = maxNumResults
      }
      blocks.push({ fileSearch: fileSearchConfig })
      continue
    }
    fnDecls.push({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })
  }
  if (fnDecls.length > 0) blocks.unshift({ functionDeclarations: fnDecls })
  return blocks
}

/**
 * Translate a typed `FileSearchFilter` (OpenAI-shaped) into Gemini's
 * `metadataFilter` string syntax (#B8.5).
 *
 * - `{ type: 'eq',  key, value }` → `key = value`
 * - `{ type: 'ne',  key, value }` → `key != value`
 * - `{ type: 'gt',  key, value }` → `key > value`
 * - `{ type: 'gte', key, value }` → `key >= value`
 * - `{ type: 'lt',  key, value }` → `key < value`
 * - `{ type: 'lte', key, value }` → `key <= value`
 * - `{ type: 'and', filters }`    → `(f1) AND (f2) AND ...`
 * - `{ type: 'or',  filters }`    → `(f1) OR (f2) OR ...`
 *
 * String values are wrapped in double quotes with `"` and `\` escaped.
 * Numbers and booleans render bare.
 *
 * Exported for unit testing — see `google-vector-stores.test.ts`.
 *
 * @internal
 */
export function filterToGeminiString(filter: FileSearchFilter): string {
  switch (filter.type) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op = GEMINI_FILTER_OP[filter.type]
      return `${filter.key} ${op} ${formatGeminiValue(filter.value)}`
    }
    case 'and':
    case 'or': {
      if (filter.filters.length === 0) {
        throw new Error(
          `[ai-sdk] Gemini metadataFilter: ${filter.type.toUpperCase()} requires at least one sub-filter.`,
        )
      }
      const joiner = filter.type === 'and' ? ' AND ' : ' OR '
      return filter.filters.map(f => `(${filterToGeminiString(f)})`).join(joiner)
    }
  }
}

const GEMINI_FILTER_OP: Record<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte', string> = {
  eq:  '=',
  ne:  '!=',
  gt:  '>',
  gte: '>=',
  lt:  '<',
  lte: '<=',
}

function formatGeminiValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return String(value)
}

function toGeminiToolConfig(choice: ToolChoice): unknown {
  if (choice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } }
  if (choice === 'required') return { functionCallingConfig: { mode: 'ANY' } }
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
  if (typeof choice === 'object' && 'name' in choice) {
    return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } }
  }
  return { functionCallingConfig: { mode: 'AUTO' } }
}

function fromGeminiResponse(response: any): ProviderResponse {
  const candidate = response.candidates?.[0]
  const toolCalls: ToolCall[] = []
  let text = ''

  for (const part of candidate?.content?.parts ?? []) {
    if (part.text) text += part.text
    if (part.functionCall) {
      toolCalls.push({
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      })
    }
  }

  return {
    message: {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    usage: {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  }
}

// ─── Embedding Adapter ──────────────────────────────────

class GoogleEmbeddingAdapter implements EmbeddingAdapter {
  private client: any = null

  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async embed(input: string | string[]): Promise<EmbeddingResult> {
    const client = await this.getClient()
    const inputs = Array.isArray(input) ? input : [input]

    const results = await Promise.all(
      inputs.map(text =>
        client.models.embedContent({
          model: this.model,
          content: { parts: [{ text }] },
        }),
      ),
    )

    const embeddings = results.map((r: any) => r.embedding?.values ?? [])

    return {
      embeddings,
      usage: { promptTokens: 0, totalTokens: 0 },
    }
  }
}

// ─── Image Generation Adapter (Imagen) ──────────────────

const GOOGLE_IMAGE_SIZE_MAP: Record<string, string> = {
  square: '1024x1024',
  landscape: '1792x1024',
  portrait: '1024x1792',
}

class GoogleImageAdapter implements ImageGenerationAdapter {
  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
  ) {}

  async generate(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const size = options.size
      ? (GOOGLE_IMAGE_SIZE_MAP[options.size] ?? options.size)
      : '1024x1024'

    const [width, height] = size.split('x').map(Number)

    const body: Record<string, unknown> = {
      instances: [{ prompt: options.prompt }],
      parameters: {
        sampleCount: options.n ?? 1,
        ...(width && height ? { aspectRatio: `${width}:${height}` } : {}),
      },
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.config.apiKey}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`[ai-sdk] Google image generation error: ${res.status} ${await res.text()}`)
    }

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
    }

    return {
      images: (data.predictions ?? []).map((p: any) => ({
        ...(p.bytesBase64Encoded ? { base64: p.bytesBase64Encoded as string } : {}),
      })),
      model: this.model,
    }
  }
}

// ─── Files ──────────────────────────────────────────────

class GoogleFileAdapter implements FileAdapter {
  private client: any = null

  constructor(private readonly config: GoogleConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async upload(options: FileUploadOptions): Promise<FileUploadResult> {
    const client = await this.getClient()
    const { readFile, stat } = await import(/* @vite-ignore */ 'node:fs/promises' as string)
    const { basename } = await import(/* @vite-ignore */ 'node:path' as string)
    const data = await readFile(options.filePath)
    const stats = await stat(options.filePath)
    const filename = basename(options.filePath)

    const response = await client.files.upload({
      file: new Blob([data]),
      config: { displayName: filename },
    })

    return {
      id: response.name ?? response.uri,
      filename,
      bytes: stats.size,
    }
  }

  async list(): Promise<FileListResult> {
    const client = await this.getClient()
    const response = await client.files.list()
    const files: FileUploadResult[] = []
    for (const f of response.files ?? response ?? []) {
      files.push({
        id: f.name ?? f.uri,
        filename: f.displayName ?? f.name ?? '',
        bytes: Number(f.sizeBytes ?? 0),
      })
    }
    return { files }
  }

  async delete(fileId: string): Promise<void> {
    const client = await this.getClient()
    await client.files.delete({ name: fileId })
  }
}

// ─── Vector Stores (Gemini FileSearchStores, #B8.5) ──────
//
// Gemini's hosted RAG surface is `ai.fileSearchStores.*` — a direct
// OpenAI-equivalent that handles ingestion, chunking, embedding, and
// retrieval server-side. NOT available on Vertex AI; the underlying SDK
// methods throw for Vertex clients.
//
// Mapping decisions:
// - `VectorStoreInfo.id` is the full Gemini resource name
//   (`fileSearchStores/foo-bar`). Apps pass it back verbatim to `get` /
//   `delete` / `addFile`.
// - `VectorStoreInfo.name` is `displayName`. The OpenAI adapter populates
//   it from the store's name field; we use the user-supplied display name
//   to keep `create('Knowledge Base')` round-trip-able.
// - `createdAt` is parsed from ISO 8601 to Unix seconds for parity with
//   OpenAI's `created_at`.
// - `fileCount` sums `activeDocumentsCount + pendingDocumentsCount` (both
//   string-encoded). `failedDocumentsCount` is dropped — it's surfaced
//   per-file via `addFile`'s status when polling.
// - `bytesUsed` is parsed from `sizeBytes` (string-encoded).
// - Store-level `metadata` and `expiresAfter` are NOT supported by Gemini.
//   Passing them throws fail-loud so apps don't silently lose data.
//
// `addFile` paths:
// - `{ fileId }` → `importFile` (re-uses an existing Files API file).
// - `{ filePath | fileBuffer }` → `uploadToFileSearchStore` (single-shot
//   upload). Both paths return long-running operations; default
//   `wait: true` polls `client.operations.get` until `done`.
// - `attributes` (Record<string, primitive>) → Gemini's `customMetadata`
//   array shape; booleans coerce to `stringValue: 'true' | 'false'`.

class GoogleVectorStoreAdapter implements VectorStoreAdapter {
  private client: any = null

  constructor(private readonly config: GoogleConfig) {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk: any = await import(/* @vite-ignore */ '@google/genai')
    const GoogleGenAI = sdk.GoogleGenAI ?? sdk.default
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey })
    return this.client
  }

  async create(opts: VectorStoreCreateOptions): Promise<VectorStoreInfo> {
    if (opts.metadata) {
      throw new Error(
        '[ai-sdk] Gemini FileSearchStores does not support store-level metadata. ' +
        'Attach searchable metadata per-document via addFile({ attributes }).',
      )
    }
    if (opts.expiresAfter) {
      throw new Error(
        '[ai-sdk] Gemini FileSearchStores does not support expiresAfter. ' +
        'Stores persist until explicitly deleted via VectorStores.delete().',
      )
    }
    const client = await this.getClient()
    const response = await client.fileSearchStores.create({
      config: { displayName: opts.name },
    })
    return fromGeminiFileSearchStore(response, opts.name)
  }

  async list(opts?: VectorStoreListOptions): Promise<VectorStoreList> {
    const client = await this.getClient()
    const config: Record<string, unknown> = {}
    if (opts?.limit !== undefined) config['pageSize']  = opts.limit
    if (opts?.after !== undefined) config['pageToken'] = opts.after
    // Gemini paginates forward via pageToken only — `before` has no
    // equivalent. Drop it silently (matches OpenAI when `before` is unset).
    const pager = await client.fileSearchStores.list({ config })
    const items: unknown[] = Array.isArray(pager?.page) ? pager.page : []
    return { stores: items.map(item => fromGeminiFileSearchStore(item)) }
  }

  async get(id: string): Promise<VectorStoreInfo> {
    const client = await this.getClient()
    const response = await client.fileSearchStores.get({ name: id })
    return fromGeminiFileSearchStore(response)
  }

  async delete(id: string): Promise<void> {
    const client = await this.getClient()
    // `force: true` mirrors OpenAI's behavior — deleting a store also
    // drops attached documents. Without `force`, Gemini returns
    // FAILED_PRECONDITION when the store has any documents.
    await client.fileSearchStores.delete({ name: id, config: { force: true } })
  }

  async addFile(storeId: string, opts: VectorStoreAddOptions): Promise<VectorStoreFileInfo> {
    const client = await this.getClient()

    const customMetadata = opts.attributes ? attributesToCustomMetadata(opts.attributes) : undefined

    // Path 1: re-use an existing Files API file.
    if (opts.fileId) {
      const importConfig: Record<string, unknown> = {}
      if (customMetadata)        importConfig['customMetadata'] = customMetadata
      if (opts.chunkingStrategy) importConfig['chunkingConfig'] = opts.chunkingStrategy
      const op = await client.fileSearchStores.importFile({
        fileSearchStoreName: storeId,
        fileName: opts.fileId,
        config: importConfig,
      })
      return finishVectorStoreOperation(client, op, storeId, opts)
    }

    // Path 2: upload a local file directly. Either `filePath` or
    // `fileBuffer` is required — Gemini's SDK accepts a path string OR a
    // Blob. For `filePath`, the SDK infers mimeType from the extension;
    // for `fileBuffer`, it reads `blob.type` which is empty on a
    // untyped `new Blob([data])`, so we forward an explicit `mimeType`
    // derived from `filename` to avoid `Can not determine mimeType`.
    if (opts.filePath || opts.fileBuffer) {
      const uploadConfig: Record<string, unknown> = {}
      if (customMetadata)        uploadConfig['customMetadata'] = customMetadata
      if (opts.chunkingStrategy) uploadConfig['chunkingConfig'] = opts.chunkingStrategy
      if (opts.fileBuffer?.filename) uploadConfig['displayName'] = opts.fileBuffer.filename
      if (opts.fileBuffer?.filename) {
        const mimeType = mimeTypeFromFilename(opts.fileBuffer.filename)
        if (mimeType) uploadConfig['mimeType'] = mimeType
      }

      const file = opts.filePath ?? new Blob([opts.fileBuffer!.data])
      const op = await client.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeId,
        file,
        config: uploadConfig,
      })
      return finishVectorStoreOperation(client, op, storeId, opts)
    }

    throw new Error(
      '[ai-sdk] addFile requires fileId, filePath, or fileBuffer. ' +
      'Pass an existing Gemini Files API id via { fileId } (e.g. `files/abc-123`) or ' +
      'a local source via { filePath } / { fileBuffer }.',
    )
  }

  async removeFile(storeId: string, fileId: string): Promise<void> {
    const client = await this.getClient()
    // Document resource names are `fileSearchStores/<store>/documents/<doc>`.
    // Apps that pass the full path use it verbatim; apps that pass only
    // the document id get the store prefix joined for them.
    const name = fileId.includes('/documents/') ? fileId : `${storeId}/documents/${fileId}`
    await client.fileSearchStores.documents.delete({ name })
  }

  async listFiles(storeId: string, opts?: VectorStoreListOptions): Promise<VectorStoreFileList> {
    const client = await this.getClient()
    const config: Record<string, unknown> = {}
    if (opts?.limit !== undefined) config['pageSize']  = opts.limit
    if (opts?.after !== undefined) config['pageToken'] = opts.after
    const pager = await client.fileSearchStores.documents.list({ parent: storeId, config })
    const items: unknown[] = Array.isArray(pager?.page) ? pager.page : []
    return { files: items.map(doc => fromGeminiDocument(doc, storeId)) }
  }
}

/**
 * Wait for a long-running file ingestion operation to finish and map the
 * result into `VectorStoreFileInfo`. Honors `wait`/`pollInterval`/
 * `pollTimeout` from `VectorStoreAddOptions` (defaults: wait=true,
 * interval=1000ms, timeout=120_000ms).
 *
 * The terminal state of a Gemini ingestion op is exposed two ways:
 * - `op.error?: { code, message }` when ingestion failed.
 * - `op.response?: { documentName: 'fileSearchStores/.../documents/...' }`
 *   when successful.
 *
 * On success we follow up with a single `documents.get` to fetch
 * `state` / `sizeBytes` / `createTime`. On failure we surface the error
 * message via `lastError` and the status flips to `'failed'`.
 */
async function finishVectorStoreOperation(
  client: any,
  initialOp: any,
  storeId: string,
  opts: VectorStoreAddOptions,
): Promise<VectorStoreFileInfo> {
  if (opts.wait === false) {
    return {
      id:            initialOp?.name ?? `${storeId}/documents/pending-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'in_progress',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  const pollInterval = opts.pollInterval ?? 1000
  const pollTimeout  = opts.pollTimeout  ?? 120_000
  const deadline     = Date.now() + pollTimeout

  let current = initialOp
  while (!current?.done) {
    if (Date.now() > deadline) {
      throw new Error(
        `[ai-sdk] Gemini FileSearchStore ingestion timed out after ${pollTimeout}ms ` +
        `(store=${storeId}). Increase pollTimeout or set wait: false for fire-and-forget.`,
      )
    }
    await sleep(pollInterval)
    current = await client.operations.get({ operation: current })
  }

  if (current.error) {
    const errMessage = (current.error as { message?: string }).message ?? 'unknown error'
    return {
      id:            current.name ?? `${storeId}/documents/failed-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'failed',
      createdAt:     Math.floor(Date.now() / 1000),
      lastError:     errMessage,
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  const documentName: string | undefined = current.response?.documentName
  if (!documentName) {
    // Op done, no error, no documentName — surface as completed without
    // follow-up details rather than failing.
    return {
      id:            current.name ?? `${storeId}/documents/unknown-${Date.now()}`,
      vectorStoreId: storeId,
      status:        'completed',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }

  // Follow up with documents.get to surface real createdAt + sizeBytes.
  // Best-effort: if the get fails (rare race), fall back to the op data.
  try {
    const doc = await client.fileSearchStores.documents.get({ name: documentName })
    const info = fromGeminiDocument(doc, storeId)
    if (opts.attributes && !info.attributes) info.attributes = opts.attributes
    return info
  } catch {
    return {
      id:            documentName,
      vectorStoreId: storeId,
      status:        'completed',
      createdAt:     Math.floor(Date.now() / 1000),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    }
  }
}

/**
 * Map a Gemini `FileSearchStore` resource into the framework's
 * `VectorStoreInfo` shape. `displayNameOverride` lets `create()` populate
 * the human-friendly name from the user-supplied value when the API
 * response omits it (some response variants do).
 *
 * @internal
 */
export function fromGeminiFileSearchStore(raw: unknown, displayNameOverride?: string): VectorStoreInfo {
  const r = raw as {
    name?: string
    displayName?: string
    createTime?: string
    activeDocumentsCount?: string
    pendingDocumentsCount?: string
    sizeBytes?: string
  }
  const id = r.name ?? ''
  const active  = Number(r.activeDocumentsCount  ?? 0) || 0
  const pending = Number(r.pendingDocumentsCount ?? 0) || 0
  const result: VectorStoreInfo = {
    id,
    name:      r.displayName ?? displayNameOverride ?? id,
    createdAt: r.createTime ? Math.floor(Date.parse(r.createTime) / 1000) : Math.floor(Date.now() / 1000),
    fileCount: active + pending,
  }
  if (r.sizeBytes !== undefined) {
    const bytes = Number(r.sizeBytes)
    if (Number.isFinite(bytes)) result.bytesUsed = bytes
  }
  return result
}

/**
 * Map a Gemini `Document` resource into the framework's
 * `VectorStoreFileInfo` shape. `DocumentState` enum values flatten to the
 * shared `'in_progress' | 'completed' | 'failed' | 'cancelled'` union.
 *
 * @internal
 */
export function fromGeminiDocument(raw: unknown, storeId: string): VectorStoreFileInfo {
  const r = raw as {
    name?: string
    state?: string
    sizeBytes?: string
    createTime?: string
    customMetadata?: Array<{ key?: string; stringValue?: string; numericValue?: number; stringListValue?: { values?: string[] } }>
  }
  const status = mapGeminiDocumentState(r.state)
  const result: VectorStoreFileInfo = {
    id:            r.name ?? `${storeId}/documents/unknown`,
    vectorStoreId: storeId,
    status,
    createdAt:     r.createTime ? Math.floor(Date.parse(r.createTime) / 1000) : Math.floor(Date.now() / 1000),
  }
  if (r.sizeBytes !== undefined) {
    const bytes = Number(r.sizeBytes)
    if (Number.isFinite(bytes)) result.bytes = bytes
  }
  if (r.customMetadata && r.customMetadata.length > 0) {
    result.attributes = customMetadataToAttributes(r.customMetadata)
  }
  return result
}

function mapGeminiDocumentState(state: string | undefined): VectorStoreFileInfo['status'] {
  switch (state) {
    case 'STATE_ACTIVE':  return 'completed'
    case 'STATE_FAILED':  return 'failed'
    case 'STATE_PENDING': return 'in_progress'
    default:              return 'in_progress'
  }
}

/**
 * Convert the framework's flat attribute map to Gemini's `CustomMetadata`
 * array shape. Strings → `stringValue`, numbers → `numericValue`,
 * booleans → `stringValue: 'true' | 'false'` (Gemini has no boolean
 * variant — string is the safe lossless choice; filter-builders can
 * still match on `key = "true"`).
 *
 * @internal
 */
export function attributesToCustomMetadata(
  attrs: Record<string, string | number | boolean>,
): Array<{ key: string; stringValue?: string; numericValue?: number }> {
  return Object.entries(attrs).map(([key, value]) => {
    if (typeof value === 'number') return { key, numericValue: value }
    if (typeof value === 'boolean') return { key, stringValue: value ? 'true' : 'false' }
    return { key, stringValue: value }
  })
}

/**
 * Inverse of {@link attributesToCustomMetadata}. Drops `stringListValue`
 * variants (no flat-attribute representation; apps that need lists
 * should read the raw Document via the SDK).
 *
 * @internal
 */
export function customMetadataToAttributes(
  metadata: Array<{ key?: string; stringValue?: string; numericValue?: number; stringListValue?: { values?: string[] } }>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const entry of metadata) {
    if (!entry.key) continue
    if (entry.numericValue !== undefined) out[entry.key] = entry.numericValue
    else if (entry.stringValue !== undefined) {
      // Round-trip booleans encoded by attributesToCustomMetadata.
      if      (entry.stringValue === 'true')  out[entry.key] = true
      else if (entry.stringValue === 'false') out[entry.key] = false
      else                                    out[entry.key] = entry.stringValue
    }
    // stringListValue intentionally dropped.
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Best-effort MIME type from a filename extension. Gemini's
 * `uploadToFileSearchStore` requires a mimeType on Blob uploads (it
 * reads `blob.type`, which is empty on untyped `new Blob([data])`).
 *
 * Coverage matches Gemini's supported FileSearchStore document formats.
 * Unknown extensions return `''` — the caller drops the field so the
 * Gemini SDK's own error fires loudly rather than silently picking a
 * wrong type.
 *
 * @internal
 */
export function mimeTypeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'txt':  return 'text/plain'
    case 'md':   return 'text/markdown'
    case 'pdf':  return 'application/pdf'
    case 'html':
    case 'htm':  return 'text/html'
    case 'json': return 'application/json'
    case 'csv':  return 'text/csv'
    case 'tsv':  return 'text/tab-separated-values'
    case 'xml':  return 'application/xml'
    case 'rtf':  return 'application/rtf'
    case 'doc':  return 'application/msword'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'js':   return 'text/javascript'
    case 'ts':   return 'text/x-typescript'
    case 'py':   return 'text/x-python'
    default:     return ''
  }
}
