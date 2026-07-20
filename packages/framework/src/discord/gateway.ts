/**
 * A minimal Discord gateway client (#680): the inbound half of the Discord integration, which
 * until now was outbound-only — a webhook `POST` can notify, but it cannot read a reply (#627).
 *
 * Deliberately hand-rolled over the global `WebSocket` rather than pulling in `discord.js`. The
 * package has three runtime dependencies and builds everything else on node builtins behind
 * injectable seams; a client library for the handful of opcodes below would be the largest
 * dependency in the package by an order of magnitude.
 *
 * Implements only what a chat bot needs: identify, heartbeat, resume, and message events.
 */

/** Gateway opcodes we act on. */
export const OP = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const

/**
 * Gateway intents. `MESSAGE_CONTENT` is privileged: it must be enabled on the application in
 * Discord's developer portal, or the gateway connects and every message arrives with an empty
 * `content`. That failure is silent, which is why {@link DiscordGateway} logs it explicitly.
 */
export const INTENTS = {
  guildMessages: 1 << 9,
  directMessages: 1 << 12,
  messageContent: 1 << 15,
} as const

/** The intents a chat bot needs: messages in channels and DMs, plus their text. */
export const CHAT_INTENTS = INTENTS.guildMessages | INTENTS.directMessages | INTENTS.messageContent

/** The default gateway endpoint. v10, JSON encoding (no `zlib-stream`, no `etf`). */
export const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'

/**
 * The socket seam. Mirrors the slice of `WebSocket` this uses, so a test drives the protocol
 * with a fake and no network — the same shape the watchers use for `fetch`.
 */
export interface GatewaySocket {
  send(data: string): void
  close(): void
  onMessage(handler: (data: string) => void): void
  onClose(handler: () => void): void
  onError(handler: (err: unknown) => void): void
}

/** Opens a {@link GatewaySocket} for a url. */
export type SocketFactory = (url: string) => GatewaySocket

/** A cancellable timer, so heartbeats are deterministic under test. */
export interface Timer {
  stop(): void
}

/** Schedules `fn` every `ms`. Default wraps `setInterval` and unrefs it. */
export type IntervalFactory = (fn: () => void, ms: number) => Timer

/** Schedules `fn` once after `ms`. Default wraps `setTimeout` and unrefs it. */
export type DelayFactory = (fn: () => void, ms: number) => Timer

/** Reconnect backoff bounds. A failed connect must not become a tight loop against Discord. */
export const RECONNECT_MS = 1_000
export const RECONNECT_MAX_MS = 60_000

/** One inbound chat message, narrowed to what routing needs. */
export interface DiscordMessage {
  id: string
  channelId: string
  /** Message text. Empty when the privileged MESSAGE_CONTENT intent is not enabled. */
  content: string
  authorId: string
  authorName: string
  /** Whether the author is a bot (including us): never act on these, or two bots loop forever. */
  fromBot: boolean
  /** Set when the message replies to another, used to thread an answer back to its gate. */
  replyToId?: string
}

/** What {@link DiscordGateway} reports to its owner. */
export interface GatewayHandlers {
  onMessage(message: DiscordMessage): void
  /** Connected and identified; carries our own user id so we can ignore our own messages. */
  onReady?(selfId: string): void
  /** Non-fatal diagnostics (a failed resume, a missing intent). */
  onLog?(message: string): void
}

/** Injectable seams for {@link DiscordGateway}. */
export interface GatewayDeps {
  socket?: SocketFactory
  interval?: IntervalFactory
  delay?: DelayFactory
  url?: string
}

/** A {@link SocketFactory} over the global `WebSocket` (node >= 22 ships one). */
export function nodeSocketFactory(): SocketFactory {
  return url => {
    const ws = new WebSocket(url)
    return {
      send: data => ws.send(data),
      close: () => ws.close(),
      onMessage: handler => ws.addEventListener('message', event => handler(String((event as MessageEvent).data))),
      onClose: handler => ws.addEventListener('close', () => handler()),
      onError: handler => ws.addEventListener('error', err => handler(err)),
    }
  }
}

/** The default {@link IntervalFactory}: unref'd, so a heartbeat never keeps the daemon alive. */
export function nodeIntervalFactory(): IntervalFactory {
  return (fn, ms) => {
    const timer = setInterval(fn, ms)
    timer.unref?.()
    return { stop: () => clearInterval(timer) }
  }
}

/** The default {@link DelayFactory}: unref'd, so a pending reconnect never keeps the daemon alive. */
export function nodeDelayFactory(): DelayFactory {
  return (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return { stop: () => clearTimeout(timer) }
  }
}

/**
 * A connected Discord bot session. Owns the socket, the heartbeat, and the resume state; hands
 * every chat message to its {@link GatewayHandlers}.
 *
 * Errors are swallowed into `onLog` rather than thrown: a notifier must never take the daemon
 * down, which is the same contract the intervention/activity watchers follow.
 */
export class DiscordGateway {
  private socket: GatewaySocket | undefined
  private heartbeat: Timer | undefined
  private sequence: number | undefined
  private sessionId: string | undefined
  private resumeUrl: string | undefined
  private acked = true
  private selfId: string | undefined
  /** Set by {@link stop}, so a socket closing on our own terms never reconnects. */
  private stopped = false
  /** Consecutive reconnects, for the backoff. Reset once a connection actually works. */
  private attempts = 0
  private pendingReconnect: Timer | undefined

  constructor(
    private readonly token: string,
    private readonly handlers: GatewayHandlers,
    private readonly deps: GatewayDeps = {},
  ) {}

  /** Open the connection and identify. Safe to call once; use {@link stop} to end it. */
  connect(): void {
    this.stopped = false
    this.open(this.deps.url ?? GATEWAY_URL)
  }

  /**
   * Close the connection for good. This is what takes the bot offline on `Ctrl+C` (#680): the
   * daemon calls it from its shutdown block, and no reconnect follows.
   */
  stop(): void {
    this.stopped = true
    this.heartbeat?.stop()
    this.heartbeat = undefined
    this.pendingReconnect?.stop()
    this.pendingReconnect = undefined
    try {
      this.socket?.close()
    } catch {
      // Already closing; nothing to do.
    }
    this.socket = undefined
  }

  /** Our own user id once READY has landed. */
  get userId(): string | undefined {
    return this.selfId
  }

  private open(url: string): void {
    const factory = this.deps.socket ?? nodeSocketFactory()
    let socket: GatewaySocket
    try {
      socket = factory(url)
    } catch (err) {
      this.log(`could not open the Discord gateway: ${errText(err)}`)
      return
    }
    this.socket = socket
    socket.onMessage(data => this.receive(data))
    socket.onError(err => this.log(`Discord gateway error: ${errText(err)}`))
    socket.onClose(() => this.reopen())
  }

  /**
   * A closed socket we did not close ourselves: resume if we can, else identify fresh.
   *
   * Backed off, and that is not a nicety: a connection that fails immediately (offline, a bad
   * token) closes as fast as it opens, so reconnecting inline is a tight loop that pins a core
   * and gets the bot rate-limited. Doubles to a cap, and resets once a connection works.
   */
  private reopen(): void {
    this.heartbeat?.stop()
    this.heartbeat = undefined
    if (this.stopped) return

    const wait = Math.min(RECONNECT_MS * 2 ** this.attempts, RECONNECT_MAX_MS)
    this.attempts++
    const schedule = this.deps.delay ?? nodeDelayFactory()
    this.pendingReconnect?.stop()
    this.pendingReconnect = schedule(() => {
      if (this.stopped) return
      this.open(this.resumeUrl ?? this.deps.url ?? GATEWAY_URL)
    }, wait)
  }

  private receive(raw: string): void {
    let payload: { op?: number; d?: unknown; s?: number; t?: string }
    try {
      payload = JSON.parse(raw)
    } catch {
      return // A frame we cannot read is not a frame we can act on.
    }
    if (typeof payload.s === 'number') this.sequence = payload.s

    switch (payload.op) {
      case OP.hello:
        this.onHello(payload.d)
        return
      case OP.heartbeatAck:
        this.acked = true
        return
      case OP.heartbeat:
        this.sendHeartbeat()
        return
      case OP.reconnect:
        // Discord asked us to move; close and let onClose resume us.
        this.socket?.close()
        return
      case OP.invalidSession:
        // The session is gone: drop it so the reconnect identifies fresh instead of resuming.
        this.sessionId = undefined
        this.resumeUrl = undefined
        this.socket?.close()
        return
      case OP.dispatch:
        this.onDispatch(payload.t, payload.d)
        return
      default:
        return
    }
  }

  private onHello(data: unknown): void {
    const interval = asRecord(data)?.['heartbeat_interval']
    const ms = typeof interval === 'number' && interval > 0 ? interval : 45_000
    const schedule = this.deps.interval ?? nodeIntervalFactory()
    this.acked = true
    this.heartbeat = schedule(() => {
      // A missed ACK means the connection is a zombie: drop it and let onClose resume.
      if (!this.acked) {
        this.log('Discord gateway missed a heartbeat ack; reconnecting')
        this.socket?.close()
        return
      }
      this.acked = false
      this.sendHeartbeat()
    }, ms)

    if (this.sessionId) this.resume()
    else this.identify()
  }

  private identify(): void {
    this.send({
      op: OP.identify,
      d: {
        token: this.token,
        intents: CHAT_INTENTS,
        properties: { os: process.platform, browser: 'the-framework', device: 'the-framework' },
      },
    })
  }

  private resume(): void {
    this.send({ op: OP.resume, d: { token: this.token, session_id: this.sessionId, seq: this.sequence ?? 0 } })
  }

  private sendHeartbeat(): void {
    this.send({ op: OP.heartbeat, d: this.sequence ?? null })
  }

  private onDispatch(type: string | undefined, data: unknown): void {
    if (type === 'READY') {
      this.attempts = 0 // A connection that reached READY is healthy; start the backoff over.
      const d = asRecord(data)
      this.sessionId = asString(d?.['session_id'])
      const resume = asString(d?.['resume_gateway_url'])
      // Discord's resume url carries no query, so keep our version/encoding on it.
      if (resume) this.resumeUrl = `${resume}?v=10&encoding=json`
      this.selfId = asString(asRecord(d?.['user'])?.['id'])
      if (this.selfId) this.handlers.onReady?.(this.selfId)
      return
    }
    if (type === 'RESUMED') return
    if (type !== 'MESSAGE_CREATE') return

    const message = parseMessage(data)
    if (!message) return
    // Never act on a bot's message, our own most of all: two bots replying to each other is an
    // unbounded loop that costs real money.
    if (message.fromBot || message.authorId === this.selfId) return
    if (!message.content.trim()) {
      this.log('a Discord message arrived with no content: enable the MESSAGE CONTENT intent for the bot')
      return
    }
    this.handlers.onMessage(message)
  }

  private send(payload: unknown): void {
    try {
      this.socket?.send(JSON.stringify(payload))
    } catch (err) {
      this.log(`could not send to the Discord gateway: ${errText(err)}`)
    }
  }

  private log(message: string): void {
    this.handlers.onLog?.(message)
  }
}

/** Narrow a MESSAGE_CREATE payload; `undefined` when it is not a shape we can use. */
export function parseMessage(data: unknown): DiscordMessage | undefined {
  const d = asRecord(data)
  if (!d) return undefined
  const author = asRecord(d['author'])
  const id = asString(d['id'])
  const channelId = asString(d['channel_id'])
  const authorId = asString(author?.['id'])
  if (!id || !channelId || !authorId) return undefined

  const message: DiscordMessage = {
    id,
    channelId,
    content: asString(d['content']) ?? '',
    authorId,
    authorName: asString(author?.['global_name']) ?? asString(author?.['username']) ?? authorId,
    fromBot: author?.['bot'] === true,
  }
  const replyTo = asString(asRecord(d['referenced_message'])?.['id'])
  if (replyTo) message.replyToId = replyTo
  return message
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
