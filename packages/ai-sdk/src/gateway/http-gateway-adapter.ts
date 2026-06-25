import type {
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
} from '../types.js'
import { parseSseStream, type SseEvent } from './sse.js'

/**
 * Connection config shared by every gateway adapter. Subclasses may extend
 * this with gateway-specific fields (region, project id, ...).
 */
export interface GatewayAdapterConfig {
  /** Base URL of the gateway endpoint. */
  baseUrl: string
  /** Optional API key — surfaced for {@link HttpGatewayAdapter.buildHeaders}. */
  apiKey?: string | undefined
  /** Static headers merged into every request (auth from `buildHeaders` wins). */
  headers?: Record<string, string> | undefined
}

/** Context passed to the request-shaping hooks. */
export interface GatewayRequestContext {
  /** `true` for the streaming (`stream()`) path, `false` for `generate()`. */
  stream: boolean
}

/**
 * Abstract template for normalizing an upstream LLM gateway behind the
 * framework's {@link ProviderAdapter} contract.
 *
 * This is the Laravel custom-driver pattern (Template Method): the base class
 * owns the reusable lifecycle — `fetch`, JSON / SSE handling, `AbortSignal`
 * wiring, and error mapping — and leaves four `protected abstract` hooks for
 * the gateway's wire format:
 *
 * - {@link buildHeaders} — the gateway's auth scheme.
 * - {@link buildRequestBody} — map {@link ProviderRequestOptions} → the
 *   gateway's request envelope.
 * - {@link parseResponse} — map a non-streaming response → {@link ProviderResponse}.
 * - {@link parseStreamEvent} — map one {@link SseEvent} → zero or more
 *   {@link StreamChunk}s.
 *
 * Reach for this only when the gateway's wire format matches no built-in
 * provider. An OpenAI- or Anthropic-compatible gateway needs no subclass:
 * register the `openai` / `anthropic` driver with a `baseUrl` override instead.
 *
 * Register a subclass through the usual factory path — `AiRegistry.register()`
 * (the framework's `extend()` equivalent).
 *
 * @example
 * ```ts
 * class AcmeGatewayAdapter extends HttpGatewayAdapter {
 *   protected buildHeaders() {
 *     return { authorization: `Bearer ${this.config.apiKey}` }
 *   }
 *   protected buildRequestBody(o: ProviderRequestOptions, ctx: GatewayRequestContext) {
 *     return { model: this.model, messages: o.messages, stream: ctx.stream }
 *   }
 *   protected parseResponse(json: any): ProviderResponse {
 *     return {
 *       message: { role: 'assistant', content: json.text },
 *       usage: { promptTokens: json.usage.in, completionTokens: json.usage.out, totalTokens: json.usage.total },
 *       finishReason: 'stop',
 *     }
 *   }
 *   protected parseStreamEvent(e: SseEvent): StreamChunk[] {
 *     if (e.data === '[DONE]') return [{ type: 'finish', finishReason: 'stop' }]
 *     const { delta } = JSON.parse(e.data)
 *     return delta ? [{ type: 'text-delta', text: delta }] : []
 *   }
 * }
 * ```
 */
export abstract class HttpGatewayAdapter implements ProviderAdapter {
  constructor(
    protected readonly config: GatewayAdapterConfig,
    protected readonly model: string,
  ) {}

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const res = await this.send(options, { stream: false })
    const json = (await res.json()) as unknown
    return this.parseResponse(json)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const res = await this.send(options, { stream: true })
    if (!res.body) {
      throw new Error('[Rudder AI] Gateway stream response had no body')
    }
    for await (const event of parseSseStream(res.body, options.signal)) {
      for (const chunk of this.parseStreamEvent(event)) yield chunk
    }
  }

  // ─── reusable plumbing ─────────────────────────────────────

  /** Perform the POST, wire the abort signal, and map error responses. */
  private async send(options: ProviderRequestOptions, ctx: GatewayRequestContext): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: ctx.stream ? 'text/event-stream' : 'application/json',
      ...this.config.headers,
      ...this.buildHeaders(),
    }
    const res = await fetch(this.endpoint(ctx), {
      method: 'POST',
      headers,
      body: JSON.stringify(this.buildRequestBody(options, ctx)),
      ...(options.signal ? { signal: options.signal } : {}),
    })
    if (!res.ok) await this.onErrorResponse(res)
    return res
  }

  /**
   * Resolve the request URL. Defaults to {@link GatewayAdapterConfig.baseUrl}
   * for both paths; override to append a path or branch on `ctx.stream`.
   */
  protected endpoint(_ctx: GatewayRequestContext): string {
    return this.config.baseUrl
  }

  /**
   * Map a non-2xx response to an error. Override to parse a gateway-specific
   * error envelope. The default reads the body as text and throws.
   */
  protected async onErrorResponse(res: Response): Promise<never> {
    const body = await res.text().catch(() => '')
    throw new Error(
      `[Rudder AI] Gateway request failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
    )
  }

  // ─── provider-specific hooks ───────────────────────────────

  /** Auth/identity headers for every request (merged over `config.headers`). */
  protected abstract buildHeaders(): Record<string, string>

  /** Map the framework request to the gateway's request envelope. */
  protected abstract buildRequestBody(
    options: ProviderRequestOptions,
    ctx: GatewayRequestContext,
  ): unknown

  /** Map a complete (non-streaming) gateway response to a {@link ProviderResponse}. */
  protected abstract parseResponse(json: unknown): ProviderResponse

  /** Map one parsed {@link SseEvent} to zero or more {@link StreamChunk}s. */
  protected abstract parseStreamEvent(event: SseEvent): StreamChunk[]
}
