/**
 * Neutral job-dispatch contract behind `agent.queue('...').send()`.
 *
 * `@gemstack/ai-sdk` does not bundle or depend on any queue implementation.
 * Register one once at startup via {@link configureAiQueue}. A host framework
 * may wire this for you; check its AI integration docs.
 *
 * `dispatch` enqueues `fn` to run later on a worker.
 */
export type QueueDispatch = (
  fn: () => void | Promise<void>,
  options?: { queue?: string; delay?: number },
) => Promise<void>

/**
 * Neutral broadcast contract behind `.broadcast(channel)`. Optional — only
 * needed when a queued job streams progress to a channel. Pushes one `event`
 * (`chunk` | `done` | `error`, optionally prefixed) with its `data` payload to
 * a named `channel`.
 */
export type QueueBroadcast = (
  channel: string,
  event: string,
  data: unknown,
) => void | Promise<void>
