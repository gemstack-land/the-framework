import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  DiscordGateway,
  parseMessage,
  CHAT_INTENTS,
  INTENTS,
  OP,
  type GatewaySocket,
  type DiscordMessage,
} from './gateway.js'

/** A fake {@link GatewaySocket}, so the whole protocol is driven with no network. */
function fakeSocket() {
  const sent: Record<string, unknown>[] = []
  let onMessage: ((data: string) => void) | undefined
  let onClose: (() => void) | undefined
  let closed = 0
  const socket: GatewaySocket = {
    send: data => sent.push(JSON.parse(data)),
    close: () => {
      closed++
      onClose?.()
    },
    onMessage: handler => {
      onMessage = handler
    },
    onClose: handler => {
      onClose = handler
    },
    onError: () => {},
  }
  return {
    socket,
    sent,
    get closed() {
      return closed
    },
    receive: (payload: unknown) => onMessage?.(JSON.stringify(payload)),
  }
}

/** A manual clock: the heartbeat fires only when the test says so. */
function fakeInterval() {
  let fn: (() => void) | undefined
  let stopped = false
  return {
    factory: (callback: () => void) => {
      fn = callback
      return { stop: () => { stopped = true } }
    },
    tick: () => fn?.(),
    get stopped() {
      return stopped
    },
  }
}

/** A manual reconnect timer: the test decides when a backed-off reconnect actually fires. */
function fakeDelay() {
  const waits: number[] = []
  let fn: (() => void) | undefined
  return {
    factory: (callback: () => void, ms: number) => {
      waits.push(ms)
      fn = callback
      return { stop: () => { fn = undefined } }
    },
    waits,
    fire: () => {
      const run = fn
      fn = undefined
      run?.()
    },
  }
}

function connect(handlers: { onMessage?: (m: DiscordMessage) => void; onLog?: (m: string) => void } = {}) {
  const socket = fakeSocket()
  const clock = fakeInterval()
  const delay = fakeDelay()
  const gateway = new DiscordGateway(
    'tok',
    { onMessage: handlers.onMessage ?? (() => {}), ...(handlers.onLog ? { onLog: handlers.onLog } : {}) },
    { socket: () => socket.socket, interval: clock.factory, delay: delay.factory, url: 'wss://test' },
  )
  gateway.connect()
  return { gateway, socket, clock, delay }
}

const HELLO = { op: OP.hello, d: { heartbeat_interval: 41250 } }
const READY = { op: OP.dispatch, t: 'READY', s: 1, d: { session_id: 's1', resume_gateway_url: 'wss://resume', user: { id: 'self' } } }

function messageEvent(over: Record<string, unknown> = {}) {
  return {
    op: OP.dispatch,
    t: 'MESSAGE_CREATE',
    s: 2,
    d: { id: 'm1', channel_id: 'c1', content: 'hello', author: { id: 'u1', username: 'sul' }, ...over },
  }
}

test('a synchronously-failing socket factory backs off and retries instead of dying (#942)', () => {
  const socket = fakeSocket()
  const delay = fakeDelay()
  const clock = fakeInterval()
  const logs: string[] = []
  let calls = 0
  const gateway = new DiscordGateway(
    'tok',
    { onMessage: () => {}, onLog: m => logs.push(m) },
    {
      socket: () => {
        calls++
        if (calls === 1) throw new Error('Invalid URL')
        return socket.socket
      },
      interval: clock.factory,
      delay: delay.factory,
      url: 'wss://test',
    },
  )
  gateway.connect()
  assert.equal(calls, 1)
  assert.ok(logs.some(l => /could not open/.test(l)), logs.join(','))
  // The bug: no socket means no onClose, so without falling through to the backoff the
  // bot is offline for the daemon's lifetime — zero loop instead of a tight one.
  assert.equal(delay.waits.length, 1, 'a backed-off reconnect is scheduled')

  delay.fire()
  assert.equal(calls, 2, 'the backoff retried the connect')
  socket.receive(HELLO)
  assert.ok(socket.sent.some(p => p['op'] === OP.identify), 'the retried connection identifies')
  gateway.stop()
})

test('stop() cancels the reconnect a sync-throwing factory scheduled (#942)', () => {
  const delay = fakeDelay()
  let calls = 0
  const gateway = new DiscordGateway(
    'tok',
    { onMessage: () => {} },
    {
      socket: () => {
        calls++
        throw new Error('Invalid URL')
      },
      interval: fakeInterval().factory,
      delay: delay.factory,
      url: 'wss://test',
    },
  )
  gateway.connect()
  assert.equal(delay.waits.length, 1)
  gateway.stop()
  delay.fire()
  assert.equal(calls, 1, 'no retry after stop')
})

test('HELLO triggers an identify with the chat intents', () => {
  const { socket } = connect()
  socket.receive(HELLO)

  const identify = socket.sent.find(p => p['op'] === OP.identify)
  assert.ok(identify, 'identified')
  const d = identify['d'] as Record<string, unknown>
  assert.equal(d['token'], 'tok')
  assert.equal(d['intents'], CHAT_INTENTS)
  // MESSAGE_CONTENT is privileged; without it every message arrives blank.
  assert.equal(CHAT_INTENTS & INTENTS.messageContent, INTENTS.messageContent)
})

test('a chat message reaches the handler', () => {
  const seen: DiscordMessage[] = []
  const { socket } = connect({ onMessage: m => seen.push(m) })
  socket.receive(HELLO)
  socket.receive(READY)
  socket.receive(messageEvent())

  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.content, 'hello')
  assert.equal(seen[0]?.authorId, 'u1')
  assert.equal(seen[0]?.channelId, 'c1')
})

test('our own messages and other bots are ignored, so two bots cannot loop', () => {
  const seen: DiscordMessage[] = []
  const { socket } = connect({ onMessage: m => seen.push(m) })
  socket.receive(HELLO)
  socket.receive(READY)
  socket.receive(messageEvent({ author: { id: 'self', username: 'us' } }))
  socket.receive(messageEvent({ author: { id: 'other', username: 'bot', bot: true } }))

  assert.equal(seen.length, 0)
})

test('an empty content says the privileged intent is missing rather than failing silently', () => {
  const logs: string[] = []
  const { socket } = connect({ onLog: m => logs.push(m) })
  socket.receive(HELLO)
  socket.receive(READY)
  socket.receive(messageEvent({ content: '' }))

  assert.ok(logs.some(l => /MESSAGE CONTENT/.test(l)), `expected an intent hint, got ${JSON.stringify(logs)}`)
})

test('heartbeats carry the last sequence, and a missed ack drops the zombie connection', () => {
  const { socket, clock } = connect()
  socket.receive(HELLO)
  socket.receive(READY) // s: 1

  clock.tick()
  const beat = socket.sent.find(p => p['op'] === OP.heartbeat)
  assert.equal(beat?.['d'], 1, 'heartbeat carries the sequence')

  // No ACK before the next tick: the connection is a zombie and must be dropped.
  const before = socket.closed
  clock.tick()
  assert.ok(socket.closed > before, 'closed the un-acked connection')
})

test('an acked heartbeat keeps the connection', () => {
  const { socket, clock } = connect()
  socket.receive(HELLO)
  clock.tick()
  socket.receive({ op: OP.heartbeatAck })
  const before = socket.closed
  clock.tick()
  assert.equal(socket.closed, before, 'still connected')
})

test('a reconnect resumes with the session, an invalid session identifies fresh', () => {
  const { socket, delay } = connect()
  socket.receive(HELLO)
  socket.receive(READY)

  // op 7: close, reopen, and RESUME rather than start over.
  socket.receive({ op: OP.reconnect })
  delay.fire()
  socket.receive(HELLO)
  assert.ok(socket.sent.some(p => p['op'] === OP.resume), 'resumed')

  // op 9: the session is gone, so the next HELLO must identify, not resume.
  const beforeIdentifies = socket.sent.filter(p => p['op'] === OP.identify).length
  socket.receive({ op: OP.invalidSession })
  delay.fire()
  socket.receive(HELLO)
  assert.equal(socket.sent.filter(p => p['op'] === OP.identify).length, beforeIdentifies + 1, 're-identified')
})

test('a failing connection backs off instead of looping tight', () => {
  // A socket that closes as fast as it opens (offline, bad token) reconnected inline would pin a
  // core and get the bot rate-limited.
  const { socket, delay } = connect()
  for (let i = 0; i < 5; i++) {
    socket.socket.close() // the server hangs up immediately
    delay.fire()
  }
  assert.deepEqual(delay.waits.slice(0, 4), [1_000, 2_000, 4_000, 8_000], 'doubling')
  assert.ok(Math.max(...delay.waits) <= 60_000, 'capped')
})

test('a healthy connection resets the backoff', () => {
  const { socket, delay } = connect()
  socket.socket.close()
  delay.fire()
  socket.socket.close()
  delay.fire()
  assert.deepEqual(delay.waits, [1_000, 2_000])

  socket.receive(HELLO)
  socket.receive(READY) // reached READY: healthy
  socket.socket.close()
  assert.equal(delay.waits.at(-1), 1_000, 'backoff started over')
})

test('stop() cancels a pending reconnect', () => {
  const { gateway, socket, delay } = connect()
  socket.socket.close() // schedules a reconnect
  gateway.stop()

  const before = socket.sent.length
  delay.fire() // the timer would have fired had it not been cancelled
  socket.receive(HELLO)
  assert.equal(socket.sent.length, before, 'stayed offline')
})

test('stop() closes the socket and does not reconnect (#680 Ctrl+C)', () => {
  const { gateway, socket, clock } = connect()
  socket.receive(HELLO)
  socket.receive(READY)

  const sentBefore = socket.sent.length
  gateway.stop()
  assert.ok(clock.stopped, 'heartbeat stopped')

  // The close handler fires; nothing should be re-sent on a socket we closed on purpose.
  socket.receive(HELLO)
  assert.equal(socket.sent.length, sentBefore, 'no identify/resume after stop')
})

test('a malformed frame is ignored, never thrown', () => {
  const { socket } = connect()
  assert.doesNotThrow(() => socket.receive('not json' as unknown))
  socket.receive({ op: 999 })
})

test('parseMessage narrows the payload and rejects an unusable one', () => {
  const parsed = parseMessage({ id: 'm', channel_id: 'c', content: 'x', author: { id: 'a', global_name: 'Sul' } })
  assert.equal(parsed?.authorName, 'Sul')
  assert.equal(parsed?.fromBot, false)
  assert.equal(parseMessage({ id: 'm' }), undefined)
  assert.equal(parseMessage(null), undefined)
})
