/**
 * The live-chat message channel (#714): the user's own turns into a running run.
 *
 * A run's await gates (#337) are the agent asking the user; this is the reverse —
 * the user speaking to the agent unprompted. Each message continues the *same*
 * agent session (`claude --resume <id>`), so the conversation keeps its full
 * context. The run loop drains this between turns and, when the agent goes idle,
 * waits here for the next message (the "stay-open" chat lifecycle): the run stays
 * running until the user stops it or a budget / await cap trips.
 *
 * Wired only when an interactive channel can deliver messages (a live dashboard /
 * daemon over `control.jsonl`). A headless run gets no {@link RunMessages}, so its
 * loop ends when the agent stops asking — byte-identical to before this existed.
 */

/** A source of user chat messages for a running run. */
export interface RunMessages {
  /**
   * The next user message. Returns an already-queued message immediately (drain
   * between turns); otherwise waits for one (stay-open). Resolves `undefined` when
   * the run should stop waiting — the signal aborted (Stop / budget cap) or the
   * source was closed — so the loop ends cleanly rather than hanging.
   */
  next(signal?: AbortSignal): Promise<string | undefined>
}

/**
 * A {@link RunMessages} the control channel feeds ({@link push}) and the run loop
 * drains ({@link next}). A message that arrives with a waiter parked hands off
 * directly; otherwise it queues until the next `next()`. FIFO in both directions.
 */
export class RunMessageQueue implements RunMessages {
  private readonly pending: string[] = []
  private readonly waiters: Array<(text: string | undefined) => void> = []
  private closed = false

  /** Enqueue a user message (or hand it to a parked waiter). No-op once closed. */
  push(text: string): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter(text)
    else this.pending.push(text)
  }

  /** Stop the chat: wake every parked waiter with `undefined` so their loops end. */
  close(): void {
    this.closed = true
    let waiter: ((text: string | undefined) => void) | undefined
    while ((waiter = this.waiters.shift())) waiter(undefined)
  }

  next(signal?: AbortSignal): Promise<string | undefined> {
    const queued = this.pending.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.closed || signal?.aborted) return Promise.resolve(undefined)
    return new Promise<string | undefined>(resolve => {
      const waiter = (text: string | undefined): void => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(text)
      }
      const onAbort = (): void => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) this.waiters.splice(i, 1)
        resolve(undefined)
      }
      this.waiters.push(waiter)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
