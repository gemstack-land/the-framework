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

/**
 * One user chat message, plus the surface it arrived through (#917).
 *
 * The origin travels with the text rather than being read off the run, because one run can be
 * spoken to from more than one surface: a session started in the dashboard and then answered from
 * Discord is a single conversation whose turns have different origins.
 */
export interface ChatMessage {
  text: string
  /** The originating surface, when the sender named one. Absent means "the run's own surface". */
  via?: string
}

/** A source of user chat messages for a running run. */
export interface RunMessages {
  /**
   * The next user message. Returns an already-queued message immediately (drain
   * between turns); otherwise waits for one (stay-open). Resolves `undefined` when
   * the run should stop waiting — the signal aborted (Stop / budget cap) or the
   * source was closed — so the loop ends cleanly rather than hanging.
   */
  next(signal?: AbortSignal): Promise<ChatMessage | undefined>
}

/**
 * A {@link RunMessages} the control channel feeds ({@link push}) and the run loop
 * drains ({@link next}). A message that arrives with a waiter parked hands off
 * directly; otherwise it queues until the next `next()`. FIFO in both directions.
 */
export class RunMessageQueue implements RunMessages {
  private readonly pending: ChatMessage[] = []
  private readonly waiters: Array<(message: ChatMessage | undefined) => void> = []
  private closed = false

  /**
   * Enqueue a user message (or hand it to a parked waiter). No-op once closed. `via` names the
   * surface it came through (#917); omitted, the run attributes it to its own.
   */
  push(text: string, via?: string): void {
    if (this.closed) return
    const message: ChatMessage = via === undefined ? { text } : { text, via }
    const waiter = this.waiters.shift()
    if (waiter) waiter(message)
    else this.pending.push(message)
  }

  /** Stop the chat: wake every parked waiter with `undefined` so their loops end. */
  close(): void {
    this.closed = true
    let waiter: ((message: ChatMessage | undefined) => void) | undefined
    while ((waiter = this.waiters.shift())) waiter(undefined)
  }

  next(signal?: AbortSignal): Promise<ChatMessage | undefined> {
    const queued = this.pending.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.closed || signal?.aborted) return Promise.resolve(undefined)
    return new Promise<ChatMessage | undefined>(resolve => {
      const waiter = (message: ChatMessage | undefined): void => {
        if (signal) signal.removeEventListener('abort', onAbort)
        resolve(message)
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
