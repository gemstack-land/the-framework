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
import { mapAnthropicStreamEvent, newAnthropicStreamState } from './anthropic-stream.js'
import { lazyClient } from './lazy-client.js'

/**
 * AWS Bedrock — managed access to foundation models on AWS infrastructure.
 *
 * v1 supports **Anthropic Claude models on Bedrock** (the dominant case on
 * AWS). Other model families on Bedrock (Llama, Nova, etc.)
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

/**
 * Builds the Bedrock runtime client. The import is dynamic so the AWS SDK stays
 * an optional dependency that is only resolved once a Bedrock adapter is used.
 */
async function createBedrockClient(config: BedrockConfig): Promise<any> {
  const sdk = await import(/* @vite-ignore */ '@aws-sdk/client-bedrock-runtime')
  const clientConfig: Record<string, unknown> = { region: config.region }
  if (config.credentials) {
    const c = config.credentials
    clientConfig['credentials'] = {
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
    }
  }
  return new sdk.BedrockRuntimeClient(clientConfig)
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
  constructor(
    private readonly config: BedrockConfig,
    private readonly model: string,
  ) {
    if (!isAnthropicOnBedrock(model)) {
      throw new Error(
        `[ai-sdk] Bedrock model "${model}" is not yet supported. v1 only supports Anthropic Claude models on Bedrock ` +
        `(model id starts with "anthropic."). File an issue at https://github.com/gemstack-land/the-framework/issues if you need another family.`,
      )
    }
  }

  private readonly getClient = lazyClient(() => createBedrockClient(this.config))

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
    const state = newAnthropicStreamState()
    for await (const event of response.body) {
      if (!event.chunk?.bytes) continue
      const decoded = JSON.parse(decoder.decode(event.chunk.bytes)) as Record<string, any>
      yield* mapAnthropicStreamEvent(decoded, state)
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

