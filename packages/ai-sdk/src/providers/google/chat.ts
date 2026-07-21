import type {
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
  ToolDefinitionSchema,
  AiMessage,
  ToolCall,
  ToolChoice,
  FinishReason,
} from '../../types.js'
import type { FileSearchFilter } from '../../file-search.js'
import { base64ToUtf8 } from '../../base64.js'
import type { GoogleCacheRegistry } from '../google-cache-registry.js'
import {
  buildGoogleCacheKey,
  splitContentsAtCache,
  durationToGoogleTtl,
  _internals as _registryInternals,
} from '../google-cache-registry.js'
import { contentToString } from '../../util/content.js'
import type { GoogleConfig } from './config.js'
import { createGoogleClient } from './client.js'
import { lazyClient } from '../lazy-client.js'
import { filterToGeminiString } from './filters.js'

// ─── Adapter ──────────────────────────────────────────────

export class GoogleAdapter implements ProviderAdapter {
  constructor(
    private readonly config: GoogleConfig,
    private readonly model: string,
    private readonly cacheRegistry?: GoogleCacheRegistry | undefined,
  ) {}

  private readonly getClient = lazyClient(() => createGoogleClient(this.config))

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
      // Drop only what the cache resource actually absorbed. The markers above
      // gate what went in, so a set like `{ messages: 2 }` caches neither the
      // system instruction nor the tools, and both must still go on the wire.
      const { fresh } = splitContentsAtCache(contents, options.cache)
      const configForCachedRequest: Record<string, unknown> = { ...config }
      if (options.cache?.tools) delete configForCachedRequest['tools']
      configForCachedRequest['cachedContent'] = cacheName
      const systemIsCached = Boolean(options.cache?.instructions && system)
      return {
        payload: {
          model: this.model,
          contents: fresh,
          ...(system && !systemIsCached ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          config: configForCachedRequest,
        },
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

    // Gemini reports `STOP` even when the turn is a function call, so the finish
    // reason has to be derived from what was actually streamed — same rule as
    // `fromGeminiResponse`, which keys off `toolCalls.length`.
    let sawFunctionCall = false

    for await (const chunk of response) {
      const candidate = chunk.candidates?.[0]
      if (!candidate) continue

      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          yield { type: 'text-delta', text: part.text }
        }
        if (part.functionCall) {
          sawFunctionCall = true
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
          finishReason: mapGeminiFinishReason(candidate.finishReason, sawFunctionCall),
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

/**
 * Map a Gemini candidate finish reason onto the neutral {@link FinishReason}.
 * A function-call turn reports `STOP`, so that case is decided by the caller
 * having seen a `functionCall` part rather than by the reason itself.
 */
export function mapGeminiFinishReason(reason: string, sawFunctionCall: boolean): FinishReason {
  if (sawFunctionCall) return 'tool_calls'
  switch (reason) {
    case 'MAX_TOKENS': return 'length'
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content_filter'
    default: return 'stop'
  }
}

// ─── Conversion Helpers ──────────────────────────────────


function contentToGeminiParts(content: string | import('../../types.js').ContentPart[]): unknown[] {
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
