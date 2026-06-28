/**
 * AI summarize, wired through the GemStack orchestration layer.
 *
 * The summarize feature does NOT call a model directly. It goes through
 * `@gemstack/ai-sdk`'s facade (`AI.prompt`) and agent loop. The deterministic
 * baseline behaviour is supplied by registering a custom *provider* on the
 * SDK's provider seam (`AiRegistry.register` + a `ProviderFactory` /
 * `ProviderAdapter`). No network, no API key: the stub adapter computes the
 * summary from the prompt it receives. Swapping in a real provider later is a
 * one-line change to the default model string.
 */
import {
  AI,
  AiRegistry,
  type AiMessage,
  type ProviderAdapter,
  type ProviderFactory,
  type ProviderRequestOptions,
  type ProviderResponse,
  type StreamChunk,
} from '@gemstack/ai-sdk'

const STUB_MODEL = 'stub/summarize-v1'

/** First sentence of `text`, trimmed to <= 140 chars. */
export function summaryOf(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^[\s\S]*?[.!?](?:\s|$)/)
  const sentence = (match ? match[0] : trimmed).trim()
  return sentence.length > 140 ? sentence.slice(0, 140).trim() : sentence
}

/** Extract the latest user-message text from a provider request. */
function lastUserText(messages: AiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') return m.content
    return m.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
  }
  return ''
}

const stubAdapter: ProviderAdapter = {
  async generate(opts: ProviderRequestOptions): Promise<ProviderResponse> {
    const summary = summaryOf(lastUserText(opts.messages))
    return {
      message: { role: 'assistant', content: summary },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
    }
  },
  async *stream(opts: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const summary = summaryOf(lastUserText(opts.messages))
    yield { type: 'text-delta', text: summary }
    yield { type: 'finish', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }
  },
}

const stubFactory: ProviderFactory = {
  name: 'stub',
  create: () => stubAdapter,
}

let registered = false
function ensureAi(): void {
  if (registered) return
  AiRegistry.register(stubFactory)
  AiRegistry.setDefault(STUB_MODEL)
  registered = true
}

/**
 * Summarize a note body through `@gemstack/ai-sdk`.
 *
 * Goes through the SDK facade + agent loop; the deterministic stub provider
 * produces the output. Returns the one-sentence summary string.
 */
export async function summarize(body: string): Promise<string> {
  ensureAi()
  const response = await AI.prompt(body, { model: STUB_MODEL })
  return response.text.trim()
}
