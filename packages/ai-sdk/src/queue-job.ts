import type { AgentPromptOptions, AgentResponse, AgentStreamResponse, StreamChunk } from './types.js'

/**
 * Optional shape on the agent reference — when set, the queued job uses
 * `stream()` to broadcast incremental progress, otherwise falls back to
 * `prompt()`. Declared conditionally so `agent.queue('...')` still works
 * without requiring `stream()` on every wrapper.
 */
type StreamableAgent = {
  prompt(input: string, options?: AgentPromptOptions): Promise<AgentResponse>
  stream?(input: string, options?: AgentPromptOptions): AgentStreamResponse
}

export interface BroadcastOptions {
  /**
   * Event name prefix on broadcast envelopes. Defaults to no prefix — events
   * are emitted as `chunk`, `done`, `error`. Set to e.g. `'agent.'` to namespace
   * (`agent.chunk`, `agent.done`, `agent.error`) when the channel carries other
   * unrelated events.
   */
  eventPrefix?: string
}

/**
 * Queued AI prompt builder.
 * Created via `agent.queue('prompt')`.
 *
 * @example
 * await agent.queue('Analyze this report')
 *   .onQueue('ai')
 *   .then(response => console.log(response.text))
 *   .catch(err => console.error(err))
 *   .send()
 *
 * @example  Broadcast progress to a channel as the job runs
 * await new SupportAgent()
 *   .queue('Help with refund request')
 *   .broadcast(`user.${userId}.support`)
 *   .send()
 *
 * // Subscribers on `user.${userId}.support` receive:
 * //   { event: 'chunk', data: <StreamChunk> }   // one per stream chunk
 * //   { event: 'done',  data: <AgentResponse> } // final result
 * //   { event: 'error', data: { message } }     // on failure
 */
export class QueuedPromptBuilder {
  private _queue = 'default'
  private _delay = 0
  private _thenFn:  ((response: AgentResponse) => void | Promise<void>) | undefined
  private _catchFn: ((error: unknown) => void | Promise<void>) | undefined
  private _broadcastChannel:     string | undefined
  private _broadcastEventPrefix = ''

  constructor(
    private readonly agentRef: StreamableAgent,
    private readonly input: string,
    private readonly options?: AgentPromptOptions,
  ) {}

  /** Set the queue name */
  onQueue(name: string): this {
    this._queue = name
    return this
  }

  /** Set a delay before the job runs */
  delay(ms: number): this {
    this._delay = ms
    return this
  }

  /** Callback when the prompt succeeds */
  then(fn: (response: AgentResponse) => void | Promise<void>): this {
    this._thenFn = fn
    return this
  }

  /** Callback when the prompt fails */
  catch(fn: (error: unknown) => void | Promise<void>): this {
    this._catchFn = fn
    return this
  }

  /**
   * Stream the agent's progress to a broadcast channel as the job runs.
   *
   * When set, the queued job uses `agent.stream()` instead of `prompt()` and
   * pushes each chunk to `channel` via `@rudderjs/broadcast`. Events:
   *
   *   - `chunk` (per `StreamChunk` from the agent)
   *   - `done`  (the final `AgentResponse`)
   *   - `error` (`{ message }` if the run fails)
   *
   * Requires `@rudderjs/broadcast` installed and its WS server running in the
   * worker process. In the typical Rudder dev setup (single process running
   * both web + queue:work) this works out of the box. If your queue worker is
   * a separate process from the broadcast WS server, you'll need a pub/sub
   * bridge (Redis, Reverb, etc.) — outside the scope of v1.
   */
  broadcast(channel: string, opts: BroadcastOptions = {}): this {
    this._broadcastChannel = channel
    if (opts.eventPrefix !== undefined) this._broadcastEventPrefix = opts.eventPrefix
    return this
  }

  /** Dispatch the job to the queue */
  async send(): Promise<void> {
    const dispatchFn = await loadDispatch()

    const agentRef = this.agentRef
    const input    = this.input
    const promptOptions    = this.options
    const thenFn           = this._thenFn
    const catchFn          = this._catchFn
    const broadcastChannel = this._broadcastChannel
    const eventPrefix      = this._broadcastEventPrefix

    await dispatchFn(async () => {
      try {
        const response = broadcastChannel !== undefined
          ? await runStreamingAndBroadcast(agentRef, input, promptOptions, broadcastChannel, eventPrefix)
          : await agentRef.prompt(input, promptOptions)
        if (thenFn) await thenFn(response)
      } catch (error) {
        if (broadcastChannel !== undefined) {
          await safeBroadcast(broadcastChannel, eventPrefix + 'error', {
            message: error instanceof Error ? error.message : String(error),
          })
        }
        if (catchFn) {
          await catchFn(error)
        } else {
          throw error
        }
      }
    }, {
      queue: this._queue,
      delay: this._delay,
    })
  }
}

// ─── Internals ────────────────────────────────────────────

type DispatchFn = (
  fn: () => void | Promise<void>,
  options?: { queue?: string; delay?: number },
) => Promise<void>
type BroadcastFn = (channel: string, event: string, data: unknown) => void | Promise<void>

let _dispatchLoader:  () => Promise<DispatchFn>          = defaultLoadDispatch
let _broadcastLoader: () => Promise<BroadcastFn | null>  = defaultLoadBroadcast

async function loadDispatch():  Promise<DispatchFn>          { return _dispatchLoader()  }
async function loadBroadcast(): Promise<BroadcastFn | null>  { return _broadcastLoader() }

async function defaultLoadDispatch(): Promise<DispatchFn> {
  try {
    const specifier = '@rudderjs/queue'
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
    return mod['dispatch'] as DispatchFn
  } catch {
    throw new Error(
      '[ai-sdk] @rudderjs/queue is required for agent.queue(). Install it: pnpm add @rudderjs/queue',
    )
  }
}

async function defaultLoadBroadcast(): Promise<BroadcastFn | null> {
  try {
    const specifier = '@rudderjs/broadcast'
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ specifier)
    const fn = mod['broadcast']
    return typeof fn === 'function' ? fn as BroadcastFn : null
  } catch {
    return null
  }
}

/**
 * Test-only seam — swap the dispatch + broadcast loaders for fakes so tests can
 * exercise the queued-job flow without booting Queue / Broadcast providers.
 *
 * The `_` prefix and explicit `ForTests` suffix are deliberate: these hooks
 * exist for `src/queue-job.test.ts`, not for app code. Production callers
 * should never import these.
 */
export function _setQueueJobLoadersForTests(opts: {
  dispatch?:  () => Promise<DispatchFn>
  broadcast?: () => Promise<BroadcastFn | null>
}): () => void {
  const prevDispatch  = _dispatchLoader
  const prevBroadcast = _broadcastLoader
  if (opts.dispatch)  _dispatchLoader  = opts.dispatch
  if (opts.broadcast) _broadcastLoader = opts.broadcast
  return () => {
    _dispatchLoader  = prevDispatch
    _broadcastLoader = prevBroadcast
  }
}

async function runStreamingAndBroadcast(
  agentRef: StreamableAgent,
  input: string,
  options: AgentPromptOptions | undefined,
  channel: string,
  eventPrefix: string,
): Promise<AgentResponse> {
  const broadcastFn = await loadBroadcast()
  if (broadcastFn === null) {
    throw new Error(
      '[ai-sdk] @rudderjs/broadcast is required for .broadcast(). Install it: pnpm add @rudderjs/broadcast',
    )
  }
  if (typeof agentRef.stream !== 'function') {
    throw new Error(
      '[ai-sdk] .broadcast() requires an agent with .stream(); the wrapper passed to QueuedPromptBuilder is missing it.',
    )
  }

  const { stream, response } = agentRef.stream(input, options)
  for await (const chunk of stream as AsyncIterable<StreamChunk>) {
    await broadcastFn(channel, eventPrefix + 'chunk', chunk)
  }
  const final = await response
  await broadcastFn(channel, eventPrefix + 'done', final)
  return final
}

async function safeBroadcast(channel: string, event: string, data: unknown): Promise<void> {
  try {
    const broadcastFn = await loadBroadcast()
    await broadcastFn?.(channel, event, data)
  } catch { /* best-effort — don't let broadcast errors mask the original failure */ }
}
