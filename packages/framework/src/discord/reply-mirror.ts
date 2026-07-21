import type { ConversationMessage } from '../conversations.js'

/**
 * Sending a session's answers back to the Discord channel that asked (#932).
 *
 * #680 delivered the inbound half: a message in Discord reaches a run over the control channel.
 * Nothing carried the answer back, so the bot only ever acknowledged ("Sent to the running
 * session.") and the reply itself was visible in the dashboard alone. That makes a chat
 * integration write-only: you can talk to the agent and never hear it.
 *
 * The source is the committed conversation (#908), not the event log. `events.jsonl` has no
 * "agent reply" kind -- `log` carries rendered console lines and `driver` carries raw driver
 * events, neither of which is the settled answer. A conversation turn is exactly the settled text
 * the user actually read, which is precisely what belongs in a chat channel.
 *
 * Which channel is a binding, not a guess: the bot records `runId -> channelId` when it starts or
 * messages a run, because that is the only moment the channel is known. A run nobody bound is
 * simply not mirrored, so a dashboard-started session never posts into a channel that never asked
 * about it (routing that generally is #606's job, not this).
 *
 * Two rules keep it from being a nuisance:
 *
 * The baseline is taken when the run is bound, not on the first poll. Adopting the transcript at
 * bind time is what stops a backlog being replayed into a channel, and taking it at bind rather
 * than at first poll closes the race where a fast agent answers before the first tick and its
 * reply is baselined away unseen.
 *
 * While the bot is switched off the cursor still advances without posting, the same contract the
 * notification watchers follow: turning it on starts from now instead of flushing everything said
 * while it was off.
 *
 * Bindings are released when their run stops resolving (#941): `readConversation` answers
 * `undefined` for a run that no longer exists (archived, or its project removed), and after a few
 * consecutive misses the poll drops the binding. Without that, every chat-touched run stayed in
 * the map for the daemon's lifetime and each poll scanned every project's live metas per bound
 * run — no misposts (an archived run resolves nothing), but per-poll IO that only ever grew. The
 * misses are counted, not acted on at first sight, so a freshly bound run whose meta is not on
 * disk yet is not dropped by the race.
 */

/** Where a run's answers go. */
export interface RunBinding {
  channelId: string
}

/** What a mirror needs from the daemon. */
export interface ReplyMirrorOptions {
  /**
   * A bound run's conversation, oldest-first. Anything unreadable should resolve `[]`, not throw.
   * `undefined` means the run itself no longer resolves (archived / project gone); after
   * {@link UNBIND_AFTER_MISSES} consecutive misses the mirror drops the binding (#941).
   */
  readConversation: (runId: string) => Promise<ConversationMessage[] | undefined>
  /** Post one answer into a channel. Resolves whether it was delivered. */
  post: (channelId: string, text: string) => Promise<boolean>
  /** Whether the bot should speak, read per poll so the toggle needs no daemon restart. */
  enabled?: () => Promise<boolean>
  /** Poll cadence, ms. Default 3s: a chat reply that lands a minute late is not a reply. */
  intervalMs?: number
  onLog?: (message: string) => void
}

/** A running mirror. */
export interface DiscordReplyMirror {
  /**
   * Start mirroring a run's answers into a channel, adopting whatever it has already said.
   * Awaitable so the caller can bind *before* handing the run a message, which is what makes the
   * next reply reliably new.
   */
  bind: (runId: string, channelId: string) => Promise<void>
  /** Stop mirroring a run (it ended, or its channel went away). */
  unbind: (runId: string) => void
  /** Whether a run is currently mirrored. */
  isBound: (runId: string) => boolean
  /** Run one poll now. Exposed so the daemon and tests can drive it deterministically. */
  poll: () => Promise<void>
  stop: () => void
}

/** Per-run state: where to post, and how far down the transcript we have already posted. */
interface Mirrored extends RunBinding {
  /** Index into the conversation; everything before it is either posted or deliberately skipped. */
  next: number
  /** Consecutive polls on which the run did not resolve; reset whenever it does. */
  misses: number
}

/** How often answers are checked for. A chat reply has to feel like a reply. */
export const REPLY_POLL_MS = 3_000

/**
 * How many consecutive unresolvable polls release a binding (#941). Generous on purpose: a
 * run bound the instant it started has no live meta on disk until its child process boots and
 * writes one, and dropping the binding during that window would silently unmirror a live chat.
 * The cost of waiting longer is only how late a dead binding's poll IO stops.
 */
export const UNBIND_AFTER_MISSES = 10

export function startDiscordReplyMirror(opts: ReplyMirrorOptions): DiscordReplyMirror {
  const bound = new Map<string, Mirrored>()
  let stopped = false
  let running = false

  const bind = async (runId: string, channelId: string): Promise<void> => {
    if (stopped) return
    // Adopt the transcript as it stands, so only what is said from here on is mirrored. Read at
    // bind time on purpose: deferring it to the first poll would swallow a reply that beat the tick.
    const existing = (await opts.readConversation(runId).catch(() => undefined)) ?? []
    bound.set(runId, { channelId, next: existing.length, misses: 0 })
  }

  const poll = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      // Read once per poll rather than per run: it gates posting, not observing.
      const on = opts.enabled ? await opts.enabled().catch(() => false) : true
      for (const [runId, state] of [...bound]) {
        if (stopped) break
        // A throw is a transient read failure and costs one poll; `undefined` is the run itself
        // being gone, and enough of those in a row release the binding (#941).
        const messages = await opts.readConversation(runId).catch((): ConversationMessage[] => [])
        if (messages === undefined) {
          state.misses++
          if (state.misses >= UNBIND_AFTER_MISSES) {
            bound.delete(runId)
            opts.onLog?.(`stopped mirroring ${runId}: its run no longer resolves`)
          }
          continue
        }
        state.misses = 0
        if (messages.length <= state.next) continue
        const fresh = messages.slice(state.next)
        // Advance first, and unconditionally: a turn we chose not to post (the bot is off, or it
        // is the user's own message coming back) must not be reconsidered next poll.
        state.next = messages.length
        if (!on) continue
        for (const message of fresh) {
          // Only the agent's side. Echoing the user's own message back at them is noise, and a
          // turn that arrived *from* Discord is already on their screen.
          if (message.role !== 'agent') continue
          const text = message.text.trim()
          if (!text) continue
          const delivered = await opts.post(state.channelId, text).catch(() => false)
          if (!delivered) opts.onLog?.(`could not deliver a reply for ${runId}`)
        }
      }
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void poll(), opts.intervalMs ?? REPLY_POLL_MS)
  timer.unref?.()

  return {
    bind,
    unbind: runId => void bound.delete(runId),
    isBound: runId => bound.has(runId),
    poll,
    stop: () => {
      stopped = true
      bound.clear()
      clearInterval(timer)
    },
  }
}
