import type {
  ProviderFactory,
  ProviderAdapter,
  ProviderRequestOptions,
  ProviderResponse,
  StreamChunk,
} from '../types.js'
import {
  splitSystemMessages,
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicToolChoice,
  fromAnthropicResponse,
  applyCacheToSystem,
  applyCacheToTools,
  applyCacheToMessages,
} from './anthropic.js'

/**
 * AWS Bedrock — managed access to foundation models on AWS infrastructure.
 *
 * v1 supports **Anthropic Claude models on Bedrock** (the dominant case for
 * Rudder users on AWS). Other model families on Bedrock (Llama, Nova, etc.)
 * surface a clear error pointing at the supported set — they can be added in
 * follow-up PRs as demand justifies.
 *
 * Auth uses the standard AWS credential chain: env vars (`AWS_ACCESS_KEY_ID`,
 * `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`), IAM roles on EC2/ECS/Lambda,
 * `~/.aws/credentials`, etc. We don't accept credentials in `BedrockConfig` —
 * use environment-aware credentials so the same code works in dev and prod.
 *
 * Model strings:
 *   `bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0`
 *   `bedrock/anthropic.claude-3-5-haiku-20241022-v1:0`
 *
 * @example
 * ```ts
 * // config/ai.ts
 * providers: {
 *   bedrock: {
 *     region: env('AWS_REGION', 'us-east-1'),
 *   },
 * }
 * ```
 */
export interface BedrockConfig {
  region: string
  /**
   * Optional explicit credentials. Prefer the AWS credential chain (env vars,
   * IAM roles); only set this for niche cases (multi-account explicit creds).
   */
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
}

export class BedrockProvider implements ProviderFactory {
  readonly name = 'bedrock'
  private readonly config: BedrockConfig

  constructor(config: BedrockConfig) {
    this.config = config
  }

  create(model: string): ProviderAdapter {
    return new BedrockAdapter(this.config, model)
  }
}

// ─── Adapter ──────────────────────────────────────────────

class BedrockAdapter implements ProviderAdapter {
  private client: any = null

  constructor(
    private readonly config: BedrockConfig,
    private readonly model: string,
  ) {
    if (!isAnthropicOnBedrock(model)) {
      throw new Error(
        `[Rudder AI] Bedrock model "${model}" is not yet supported. v1 only supports Anthropic Claude models on Bedrock ` +
        `(model id starts with "anthropic."). File an issue at https://github.com/rudderjs/rudder/issues if you need another family.`,
      )
    }
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client
    const sdk = await import(/* @vite-ignore */ '@aws-sdk/client-bedrock-runtime')
    const BedrockRuntimeClient = sdk.BedrockRuntimeClient
    const clientConfig: Record<string, unknown> = { region: this.config.region }
    if (this.config.credentials) {
      const c = this.config.credentials
      clientConfig['credentials'] = {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
      }
    }
    this.client = new BedrockRuntimeClient(clientConfig)
    return this.client
  }

  async generate(options: ProviderRequestOptions): Promise<ProviderResponse> {
    const client = await this.getClient()
    const sdk = await import(/* @vite-ignore */ '@aws-sdk/client-bedrock-runtime')
    const InvokeModelCommand = sdk.InvokeModelCommand

    const body = this.buildAnthropicBody(options)
    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    })

    const abortOpts = options.signal ? { abortSignal: options.signal } : undefined
    const response = await client.send(command, abortOpts)
    const decoded = JSON.parse(new TextDecoder().decode(response.body))
    return fromAnthropicResponse(decoded)
  }

  async *stream(options: ProviderRequestOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const sdk = await import(/* @vite-ignore */ '@aws-sdk/client-bedrock-runtime')
    const InvokeModelWithResponseStreamCommand = sdk.InvokeModelWithResponseStreamCommand

    const body = this.buildAnthropicBody(options)
    const command = new InvokeModelWithResponseStreamCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(body),
    })

    const abortOpts = options.signal ? { abortSignal: options.signal } : undefined
    const response = await client.send(command, abortOpts)
    if (!response.body) return

    const decoder = new TextDecoder()
    // See anthropic.ts for the same shape — Bedrock-Anthropic uses the
    // identical event protocol, so the prompt-token tracking is identical too.
    const state: BedrockStreamState = { lastPromptTokens: 0 }
    for await (const event of response.body) {
      if (!event.chunk?.bytes) continue
      const decoded = JSON.parse(decoder.decode(event.chunk.bytes)) as Record<string, any>
      yield* mapBedrockAnthropicEvent(decoded, state)
    }
  }

  /**
   * Build the Bedrock-Anthropic request body. The shape mirrors the native
   * Anthropic Messages API minus `model` (Bedrock takes the modelId in the
   * URL) and plus `anthropic_version` (required by Bedrock).
   *
   * Spec: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html
   */
  private buildAnthropicBody(options: ProviderRequestOptions): Record<string, unknown> {
    const { system, messages } = splitSystemMessages(options.messages)
    const cache = options.cache

    const body: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: options.maxTokens ?? 4096,
      messages: applyCacheToMessages(toAnthropicMessages(messages), cache?.messages),
    }
    const sys = applyCacheToSystem(system, cache?.instructions === true)
    if (sys !== undefined) body['system'] = sys
    if (options.temperature !== undefined) body['temperature'] = options.temperature
    if (options.topP !== undefined) body['top_p'] = options.topP
    if (options.stop) body['stop_sequences'] = options.stop
    if (options.tools?.length) {
      body['tools'] = applyCacheToTools(toAnthropicTools(options.tools), cache?.tools === true)
    }
    const choice = options.toolChoice ? toAnthropicToolChoice(options.toolChoice) : undefined
    if (choice !== undefined) body['tool_choice'] = choice
    return body
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Bedrock model ids for Anthropic look like `anthropic.claude-3-5-sonnet-20241022-v2:0`.
 * Any other prefix (`meta.`, `amazon.`, `cohere.`, `mistral.`, `ai21.`) is a
 * different model family that needs its own conversion path.
 */
export function isAnthropicOnBedrock(model: string): boolean {
  return model.startsWith('anthropic.') || model.startsWith('us.anthropic.') || model.startsWith('eu.anthropic.') || model.startsWith('apac.anthropic.')
}

/**
 * Cross-event state for Bedrock-Anthropic streaming. The Anthropic stream
 * protocol splits prompt + completion token counts across two distinct
 * events; we track the prompt count from `message_start` so the later
 * `message_delta` → `finish` chunk can emit a complete usage object.
 */
export interface BedrockStreamState {
  lastPromptTokens: number
}

/**
 * Map a single decoded Bedrock-Anthropic stream event to zero-or-more
 * `StreamChunk`s. Bedrock wraps Anthropic's native streaming events 1:1 in
 * `chunk.bytes`, so the body shape matches `anthropic.ts`'s loop — but we
 * keep the mapping here so a future model family can be added cleanly.
 *
 * `state` is mutated across calls: `message_start` captures `lastPromptTokens`,
 * the subsequent `message_delta` reads it back. Without this, the `finish`
 * chunk reports `promptTokens: 0`, the agent loop's last-wins aggregation
 * overwrites the correct earlier value, and consumers (billing, withBudget)
 * silently undercharge for streamed calls.
 */
export function* mapBedrockAnthropicEvent(
  event: Record<string, any>,
  state: BedrockStreamState,
): Generator<StreamChunk> {
  if (event['type'] === 'content_block_delta') {
    const delta = event['delta']
    if (delta?.type === 'text_delta') {
      yield { type: 'text-delta', text: delta.text }
    } else if (delta?.type === 'input_json_delta') {
      yield { type: 'tool-call-delta', text: delta.partial_json }
    }
  } else if (event['type'] === 'content_block_start' && event['content_block']?.type === 'tool_use') {
    yield {
      type: 'tool-call-delta',
      toolCall: { id: event['content_block'].id, name: event['content_block'].name },
    }
  } else if (event['type'] === 'message_delta') {
    const completionTokens = event['usage']?.output_tokens ?? 0
    yield {
      type: 'finish',
      finishReason: event['delta']?.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: state.lastPromptTokens,
        completionTokens,
        totalTokens: state.lastPromptTokens + completionTokens,
      },
    }
  } else if (event['type'] === 'message_start' && event['message']?.usage) {
    state.lastPromptTokens = event['message'].usage.input_tokens ?? 0
    // output_tokens at message_start is the SDK's initial counter (~0/1), not
    // the final completion total — don't claim a totalTokens here. The
    // `finish` chunk above carries the authoritative final usage.
    yield {
      type: 'usage',
      usage: {
        promptTokens: state.lastPromptTokens,
        completionTokens: 0,
        totalTokens: state.lastPromptTokens,
      },
    }
  }
}
