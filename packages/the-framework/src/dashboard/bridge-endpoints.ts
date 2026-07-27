import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The browser bridge (#1237): the one endpoint an extension running in the user's own Claude
 * session posts to, so a question a cloud run is parked on becomes visible in the dashboard.
 *
 * **Why this route carries its own token, unlike every other one.** The #1051 guard in
 * `startDashboard` only exists on a non-loopback bind, and what protects a loopback daemon is
 * the same-origin check on `/_telefunc`: a page on another origin is refused outright. This
 * route is the first that is *meant* to be reached from another origin, so neither of those
 * protects it, and it demands `Authorization: Bearer <daemonToken>` unconditionally instead.
 *
 * **No CORS headers, on purpose.** An extension's service worker holding `host_permissions`
 * fetches without a preflight, so the bridge does not need `Access-Control-Allow-Origin` and
 * must not have it: a wildcard here would let any page the user visits post to their daemon.
 * The cost is that the extension has to post from its background worker rather than from the
 * content script, which is a line in the extension and a much better trade.
 *
 * **What it accepts is deliberately tiny.** One shape, fully validated, with no path, command,
 * prompt or free text anywhere in it. The worst a stolen token buys is a bogus question card in
 * someone's dashboard, which is the point: this is attached to a daemon that spawns processes.
 */
export const BRIDGE_PREFIX = '/_bridge'

/** A question a cloud session is parked on, as reported by the bridge. */
export interface BridgeQuestion {
  /** The cloud session that asked, which joins back to a run through `RunMeta.sessionId`. */
  sessionId: string
  title: string
  options: { label: string; detail?: string }[]
  recommended?: string
  /** When the daemon accepted it. Set here, never by the caller. */
  receivedAt: string
}

/**
 * One thing a cloud session did, as scraped from its page (#1237).
 *
 * `seq` is the message's position in the transcript, assigned by the extension, and it is what
 * makes this idempotent: the page is re-read on every DOM change, so the same message arrives
 * many times and the daemon keeps one copy per position rather than a growing pile of repeats.
 */
export interface BridgeEvent {
  sessionId: string
  seq: number
  role: 'agent' | 'user'
  text: string
  receivedAt: string
}

/** What the page half of the bridge reports about itself, for diagnosis. */
export interface BridgeHello {
  version: string
  sessionId?: string | undefined
  note: string
  at: string
}

/** A cloud session the extension should be watching. */
export interface BridgeSession {
  id: string
  url: string
}

/**
 * A session the daemon wants the extension to create on claude.ai (#1328).
 *
 * This is the one shape that travels *out* of the bridge carrying free text, and that direction
 * is what keeps the "deliberately tiny input" rule above intact: the daemon writes it, the
 * extension reads it, and what comes back is only an id, a boolean and a session id.
 */
export interface BridgeStart {
  id: string
  /** `owner/name`, as the repo picker lists it. */
  repo: string
  branch: string
  prompt: string
}

/** What the daemon wires behind the bridge. Absent when the feature is off, which 404s it. */
export interface BridgeHandlers {
  /** The shared secret every bridge call must present. */
  token: string
  record: (question: BridgeQuestion) => void
  /** Record what the session said, keyed by its position in the transcript. */
  recordEvent?: (event: BridgeEvent) => void
  /** Note that something reached the bridge, including when it was refused. */
  contact?: (route: string, status: number) => void
  /** What the injected page script reports about itself. */
  hello?: (hello: BridgeHello) => void
  /**
   * The cloud sessions worth watching, newest first. The extension cannot know a run started:
   * it only sees pages the user is already on, so without this the bridge works only when
   * somebody happens to be looking at claude.ai. This is how a tab gets opened for them.
   */
  sessions?: () => Promise<BridgeSession[]>
  /** The answer queued in the dashboard for that session, waiting to be delivered (#1237). */
  answer?: (sessionId: string) => { id: string; label: string } | undefined
  /** The extension's word on what a delivery attempt did. */
  answered?: (sessionId: string, id: string, ok: boolean, note?: string) => void
  /**
   * The next session the daemon wants created, claimed for whoever is asking (#1328).
   *
   * Claiming is the callee's job, not this route's: two tabs polling must not both be handed the
   * same request, because a duplicate here is a duplicate cloud session on the user's account.
   */
  start?: () => BridgeStart | undefined
  /** The extension's word on what a creation attempt did (#1328). */
  started?: (id: string, ok: boolean, sessionId?: string, note?: string) => void
  now?: () => Date
}

const MAX_BODY = 64 * 1024
const SESSION_ID = /^session_[A-Za-z0-9]{1,128}$/
const MAX_TITLE = 500
const MAX_LABEL = 300
const MAX_DETAIL = 500
const MAX_OPTIONS = 20
const MAX_EVENTS_BODY = 512 * 1024
const MAX_EVENT_BATCH = 50
const MAX_EVENT_TEXT = 8000
const MAX_SEQ = 10_000

/** Route a `/_bridge/*` request. A daemon with the bridge off 404s every route. */
export async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handlers: BridgeHandlers | undefined,
): Promise<void> {
  if (!handlers) return end(res, 404, 'bridge not enabled')
  seen(handlers, pathname, res)
  if (!authorized(req, handlers.token)) return end(res, 401, 'unauthorized')
  if (pathname === `${BRIDGE_PREFIX}/ping`) {
    if (req.method !== 'GET') return end(res, 405, 'method not allowed', { allow: 'GET' })
    return end(res, 200, 'ok')
  }
  if (pathname === `${BRIDGE_PREFIX}/question`) return handleQuestion(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/sessions`) return handleSessions(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/events`) return handleEvents(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/hello`) return handleHello(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/answer`) return handleAnswer(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/answered`) return handleAnswered(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/start`) return handleStart(req, res, handlers)
  if (pathname === `${BRIDGE_PREFIX}/started`) return handleStarted(req, res, handlers)
  end(res, 404, 'not found')
}

/**
 * `Authorization: Bearer <token>`, compared in constant time. Rejects before the body is read,
 * so an unauthenticated caller cannot make the daemon buffer anything.
 */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  // timingSafeEqual throws on a length mismatch, which would itself leak the length.
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

/** `POST /_bridge/question`: validate hard, record, answer 204. */
async function handleQuestion(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY)
  } catch (err) {
    return end(res, 400, (err as Error).message)
  }
  const question = validate(body, (handlers.now ?? (() => new Date()))())
  if (typeof question === 'string') return end(res, 400, question)
  handlers.record(question)
  end(res, 204, '')
}

/**
 * Every field checked, with a reason on rejection. Unknown keys are dropped rather than
 * refused, so a newer extension posting an extra field still works against an older daemon.
 */
function validate(body: unknown, now: Date): BridgeQuestion | string {
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const raw = body as Record<string, unknown>
  const sessionId = raw.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'sessionId must look like session_<id>'
  const title = raw.title
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) return `title must be a string of 1 to ${MAX_TITLE} characters`
  if (!Array.isArray(raw.options) || raw.options.length === 0) return 'options must be a non-empty array'
  if (raw.options.length > MAX_OPTIONS) return `options must hold at most ${MAX_OPTIONS} entries`
  const options: { label: string; detail?: string }[] = []
  for (const entry of raw.options) {
    if (typeof entry !== 'object' || entry === null) return 'each option must be an object'
    const { label, detail } = entry as Record<string, unknown>
    if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL) return `each option needs a label of 1 to ${MAX_LABEL} characters`
    if (detail !== undefined && (typeof detail !== 'string' || detail.length > MAX_DETAIL)) return `an option detail must be a string of at most ${MAX_DETAIL} characters`
    options.push({ label, ...(typeof detail === 'string' && detail ? { detail } : {}) })
  }
  const recommended = raw.recommended
  if (recommended !== undefined && (typeof recommended !== 'string' || recommended.length > MAX_LABEL)) {
    return 'recommended must be a string naming one of the option labels'
  }
  // A recommendation that names no option would render a default the user cannot see.
  if (typeof recommended === 'string' && recommended && !options.some(o => o.label === recommended)) {
    return 'recommended must match one of the option labels'
  }
  return {
    sessionId,
    title,
    options,
    ...(typeof recommended === 'string' && recommended ? { recommended } : {}),
    receivedAt: now.toISOString(),
  }
}

/**
 * `POST /_bridge/hello`: what the page half of the bridge is doing.
 *
 * Diagnosis kept needing a screenshot of a panel, which meant every wrong guess cost a round
 * trip through a person. This lets the extension say for itself which version is injected and
 * what its last scrape found, so the daemon can be asked instead.
 */
async function handleHello(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY)
  } catch (err) {
    return end(res, 400, (err as Error).message)
  }
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  handlers.hello?.({
    version: typeof raw.version === 'string' ? raw.version.slice(0, 32) : 'unknown',
    sessionId: typeof raw.sessionId === 'string' && SESSION_ID.test(raw.sessionId) ? raw.sessionId : undefined,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
    at: (handlers.now ?? (() => new Date()))().toISOString(),
  })
  end(res, 204, '')
}

/** `POST /_bridge/events`: record a batch of transcript entries. */
async function handleEvents(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  if (!handlers.recordEvent) return end(res, 404, 'events not enabled')
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_EVENTS_BODY)
  } catch (err) {
    return end(res, 400, (err as Error).message)
  }
  const events = validateEvents(body, (handlers.now ?? (() => new Date()))())
  if (typeof events === 'string') return end(res, 400, events)
  for (const event of events) handlers.recordEvent(event)
  end(res, 204, '')
}

/**
 * A batch, validated entry by entry. Rejects the whole batch on a bad entry rather than taking
 * the good ones: a partial accept would leave gaps in the sequence the reader cannot distinguish
 * from a message that has not arrived yet.
 */
function validateEvents(body: unknown, now: Date): BridgeEvent[] | string {
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const raw = body as Record<string, unknown>
  const sessionId = raw.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return 'sessionId must look like session_<id>'
  if (!Array.isArray(raw.events) || raw.events.length === 0) return 'events must be a non-empty array'
  if (raw.events.length > MAX_EVENT_BATCH) return `events must hold at most ${MAX_EVENT_BATCH} entries`
  const out: BridgeEvent[] = []
  for (const entry of raw.events) {
    if (typeof entry !== 'object' || entry === null) return 'each event must be an object'
    const { seq, role, text } = entry as Record<string, unknown>
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) return 'each event needs an integer seq'
    if (role !== 'agent' && role !== 'user') return 'each event needs a role of agent or user'
    if (typeof text !== 'string' || !text.trim()) return 'each event needs text'
    out.push({ sessionId, seq, role, text: text.slice(0, MAX_EVENT_TEXT), receivedAt: now.toISOString() })
  }
  return out
}

/**
 * `GET /_bridge/answer?sessionId=...`: the answer the dashboard queued for that session (#1237).
 *
 * Always 200 with `{answer: ...}`, null when there is nothing to deliver, so the extension can
 * poll it blindly. Degrades to null on a daemon that wired no answer source, same as `sessions`.
 */
async function handleAnswer(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'GET') return end(res, 405, 'method not allowed', { allow: 'GET' })
  const sessionId = new URL(req.url ?? '', 'http://bridge.invalid').searchParams.get('sessionId')
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return end(res, 400, 'sessionId must look like session_<id>')
  const answer = handlers.answer?.(sessionId)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ answer: answer ?? null }))
}

/** `POST /_bridge/answered`: what the extension's delivery attempt did. */
async function handleAnswered(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY)
  } catch (err) {
    return end(res, 400, (err as Error).message)
  }
  if (typeof body !== 'object' || body === null) return end(res, 400, 'body must be an object')
  const { sessionId, id, ok, note } = body as Record<string, unknown>
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return end(res, 400, 'sessionId must look like session_<id>')
  if (typeof id !== 'string' || !id || id.length > 64) return end(res, 400, 'id must be the answer id')
  if (typeof ok !== 'boolean') return end(res, 400, 'ok must be a boolean')
  if (note !== undefined && typeof note !== 'string') return end(res, 400, 'note must be a string')
  handlers.answered?.(sessionId, id, ok, typeof note === 'string' ? note.slice(0, 300) : undefined)
  end(res, 204, '')
}

/**
 * `GET /_bridge/start`: the next session the daemon wants created, claimed by this call (#1328).
 *
 * Always 200 with `{start: ...}`, null when there is nothing to do, so the extension can poll it
 * blindly alongside `/answer`. Degrades to null on a daemon that wired no queue, so an extension
 * that knows about session creation does nothing at all against an older daemon.
 *
 * A GET that mutates, which is not the usual shape. The mutation is the point: handing the same
 * request to two polling tabs would create two cloud sessions, so taking it off the queue has to
 * happen in the same step as reading it.
 */
async function handleStart(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'GET') return end(res, 405, 'method not allowed', { allow: 'GET' })
  const start = handlers.start?.()
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ start: start ?? null }))
}

/** `POST /_bridge/started`: what the extension's creation attempt did (#1328). */
async function handleStarted(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'POST') return end(res, 405, 'method not allowed', { allow: 'POST' })
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_BODY)
  } catch (err) {
    return end(res, 400, (err as Error).message)
  }
  if (typeof body !== 'object' || body === null) return end(res, 400, 'body must be an object')
  const { id, ok, sessionId, note } = body as Record<string, unknown>
  if (typeof id !== 'string' || !id || id.length > 64) return end(res, 400, 'id must be the start request id')
  if (typeof ok !== 'boolean') return end(res, 400, 'ok must be a boolean')
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))) {
    return end(res, 400, 'sessionId must look like session_<id>')
  }
  if (note !== undefined && typeof note !== 'string') return end(res, 400, 'note must be a string')
  handlers.started?.(
    id,
    ok,
    typeof sessionId === 'string' ? sessionId : undefined,
    typeof note === 'string' ? note.slice(0, 300) : undefined,
  )
  end(res, 204, '')
}

/**
 * `GET /_bridge/sessions`: the cloud sessions the extension should have a tab for.
 *
 * Answers an empty list rather than a 404 when the daemon wired no lister, so an extension
 * polling an older daemon degrades to doing nothing instead of reporting a fault.
 */
async function handleSessions(req: IncomingMessage, res: ServerResponse, handlers: BridgeHandlers): Promise<void> {
  if (req.method !== 'GET') return end(res, 405, 'method not allowed', { allow: 'GET' })
  const sessions = handlers.sessions ? await handlers.sessions().catch(() => []) : []
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ sessions }))
}

/** Read a JSON body, refusing anything past the cap rather than buffering it. */
function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('body must be JSON'))
      }
    })
    req.on('error', () => reject(new Error('read failed')))
  })
}

function end(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/plain', ...headers })
  res.end(message)
}

/** Wrap a route so its outcome is recorded whatever it was. */
function seen(handlers: BridgeHandlers, pathname: string, res: ServerResponse): void {
  if (!handlers.contact) return
  res.once('finish', () => handlers.contact?.(pathname, res.statusCode))
}
