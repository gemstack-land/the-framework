import { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from '../events.js'
import { applyEventToMeta, type RunMeta } from '../store/index.js'
import type { StartRunKind, StartRunOptions, StartRunResult } from './types.js'
import { errorMessage } from '../error-message.js'

/**
 * The server-side half of "run on a connected device" (#1067). The local daemon holds the saved
 * device's token, so it - not the browser - drives the remote daemon: it POSTs the run to the
 * remote's `/_relay/start` and then fetch-streams the remote's `/_relay/events` back into a local
 * {@link EventStream}, which the dashboard reads over its normal same-origin `onEvents` channel. So
 * the browser never talks cross-origin and the token never leaves the two daemons (issue #1067 (b)).
 *
 * Authentication is the #1051 cookie, sent daemon-to-daemon: `Cookie: fw_daemon=<token>` with no
 * `Origin` header. The remote's guard admits a matching cookie without the browser-only `?token=`
 * 302, and its `/_telefunc` CSRF check (absent Origin passes) is not even on these raw routes.
 */

/** Where a relayed run executes: the remote daemon's origin and its #1051 token. Memory-only. */
export interface RemoteTarget {
  url: string
  token: string
}

/** The body a relay start forwards to the remote's `/_relay/start`. */
export interface RelayStartBody {
  prompt: string
  kind: StartRunKind
  options: StartRunOptions
}

const START_TIMEOUT_MS = 15_000

/** How long a status ping waits before calling a device offline (#1072): short, since it polls. */
const PING_TIMEOUT_MS = 3_000

/**
 * Health-check a saved device (#1072): a cookie'd `GET /_relay/ping`, true on any 2xx, false on a
 * non-2xx, an unreachable host, or the timeout. The token stays in memory for the check only, never
 * persisted, same as {@link startRemoteRun}. This is how the browser's status dots learn reachable
 * from not: it has the tokens, the daemon does the cross-origin request.
 */
export async function pingRemote(target: RemoteTarget): Promise<boolean> {
  try {
    const res = await fetch(`${trimSlashes(target.url)}/_relay/ping`, {
      headers: { cookie: `fw_daemon=${target.token}` },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/** The two headers every relay request carries: JSON, and the #1051 cookie. No Origin on purpose. */
function relayHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', cookie: `fw_daemon=${token}` }
}

/**
 * Start a run on the remote daemon and return its {@link StartRunResult} (with the remote's own run
 * id). A non-2xx or a transport failure surfaces as an `ok: false` result the dashboard shows, the
 * same shape a local refusal has, so the caller does not special-case remote errors.
 */
export async function startRemoteRun(target: RemoteTarget, body: RelayStartBody): Promise<StartRunResult> {
  try {
    const res = await fetch(`${trimSlashes(target.url)}/_relay/start`, {
      method: 'POST',
      headers: relayHeaders(target.token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, error: `the device refused the run (${res.status})` }
    return (await res.json()) as StartRunResult
  } catch (err) {
    return { ok: false, error: `could not reach the device: ${errorMessage(err)}` }
  }
}

const RPC_TIMEOUT_MS = 60_000 // a relayed git push/PR runs over the network on the device

/**
 * Relay one run-scoped RPC to the device that owns a remote run (#1067 slice 2). The local daemon
 * holds the device token, so a read/diff/handoff/push/PR for a relayed run runs ON the device: POST
 * {fn, args} to the remote's /_relay/rpc over the #1051 cookie (no Origin), returning the device's
 * result. Throws on an unreachable device or a non-2xx so the caller falls back to its own empty/error
 * shape, the same way a failed local read does.
 */
export async function relayRpc(target: RemoteTarget, fn: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${trimSlashes(target.url)}/_relay/rpc`, {
    method: 'POST',
    headers: relayHeaders(target.token),
    body: JSON.stringify({ fn, args }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`the device refused the request (${res.status})`)
  const body = (await res.json()) as { result?: unknown }
  return body.result
}

/**
 * Fetch-stream a remote run's newline-delimited events into `onEvent` until the remote closes the
 * body, the run ends, or `cancel()` is called. A 401 (the token was rotated) ends the stream
 * cleanly rather than as an error, so the dashboard sees a normal `done`, not a lost connection.
 * Returns a cancel function; calling it aborts the fetch and releases the reader.
 */
export function streamRemoteEvents(
  target: RemoteTarget,
  runId: string,
  onEvent: (event: FrameworkEvent) => void,
  onEnd?: () => void,
): () => void {
  const controller = new AbortController()
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    onEnd?.()
  }
  void (async () => {
    try {
      const url = `${trimSlashes(target.url)}/_relay/events?run=${encodeURIComponent(runId)}`
      const res = await fetch(url, { headers: relayHeaders(target.token), signal: controller.signal })
      // 401 = the device rotated its token. Nothing more will stream; end cleanly (a done, not a loss).
      if (!res.ok || !res.body) return end()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Emit every complete line, keeping the trailing partial for the next chunk.
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          emitLine(buffer.slice(0, newline), onEvent)
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
        }
      }
      emitLine(buffer, onEvent) // a final line with no trailing newline
    } catch {
      // Aborted by cancel(), or the transport dropped: either way the stream is over.
    } finally {
      end()
    }
  })()
  return () => {
    controller.abort()
    end()
  }
}

/** Parse one NDJSON line as a {@link FrameworkEvent} and forward it; a blank or malformed line is skipped. */
function emitLine(line: string, onEvent: (event: FrameworkEvent) => void): void {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    onEvent(JSON.parse(trimmed) as FrameworkEvent)
  } catch {
    // A partial or malformed line is dropped rather than crashing the pump.
  }
}

interface RelayedRun {
  target: RemoteTarget
  stream: EventStream<FrameworkEvent>
  cancel: () => void
}

/**
 * The local daemon's live relayed runs (#1067), keyed by the remote run id. Registering a run opens
 * an {@link EventStream} the dashboard reads through `onEvents`, fed by {@link streamRemoteEvents}
 * from the remote. This map is where a saved device's token lives daemon-side: in memory, for the
 * run's lifetime.
 *
 * The `targets` map outlives the event pump (#1067 slice 2): a finished remote run's post-run reads,
 * push and open-PR still have to reach the device after its event stream has ended, so the device
 * target is kept until {@link dispose} clears it, not dropped when the stream closes.
 *
 * The `metas` map (#1077) holds a local {@link RunMeta} stub per relayed run so `onRuns` can show a
 * remote run in the session list and re-open it after a dashboard reload; {@link list} projects it
 * per project. Same lifetime as `targets`: it outlives the event stream and is cleared on dispose.
 */
export class RelayedRuns {
  private readonly runs = new Map<string, RelayedRun>()
  private readonly targets = new Map<string, RemoteTarget>()
  // The local RunMeta stub for each relayed run, so onRuns can show a remote run in the session list
  // and re-open it after a reload; outlives the event stream, cleared on dispose (same lifetime as targets).
  private readonly metas = new Map<string, { meta: RunMeta; projectId: string }>()

  /** Open a local stream for a remote run and start pumping the remote's events into it. */
  register(runId: string, target: RemoteTarget, meta: RunMeta, projectId: string): void {
    this.targets.set(runId, target) // kept past the stream, for post-run reads/push/PR (slice 2)
    this.metas.set(runId, { meta, projectId }) // the local list row, so a reload re-opens the run (#1077)
    this.runs.get(runId)?.cancel() // a re-register (same id) replaces the old pump
    const stream = new EventStream<FrameworkEvent>()
    const cancel = streamRemoteEvents(target, runId, event => {
      stream.push(event)
      this.apply(runId, event) // fold the event into the run's list row, mirroring the device
    }, () => this.endStream(runId))
    this.runs.set(runId, { target, stream, cancel })
  }

  /** The live event stream for a relayed run, or undefined when this daemon is not relaying it. */
  get(runId: string | undefined): EventStream<FrameworkEvent> | undefined {
    return runId ? this.runs.get(runId)?.stream : undefined
  }

  /** The device a relayed run runs on, kept past the event stream so post-run push/PR still reach it. */
  target(runId: string | undefined): RemoteTarget | undefined {
    return runId ? this.targets.get(runId) : undefined
  }

  /** A project's relayed run stubs (#1077), newest-first, so `onRuns` can surface them in the list. */
  list(projectId: string): RunMeta[] {
    const rows: RunMeta[] = []
    for (const entry of this.metas.values()) if (entry.projectId === projectId) rows.push(entry.meta)
    // Newest first: startedAt is ISO, so a string compare is the time order (no parse).
    return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
  }

  /** Fold each relayed event into the run's list row via the store's own reducer (#1077), so the
   *  local stub mirrors the device: the terminal status on `end`, the waiting flag while it is parked
   *  (#785), the driver once its session starts. Events carry no write time, so this stamps its own. */
  private apply(runId: string, event: FrameworkEvent): void {
    const entry = this.metas.get(runId)
    if (!entry) return
    entry.meta = applyEventToMeta(entry.meta, event, new Date().toISOString())
  }

  /** Close a relayed run's event stream (not its target). Idempotent. */
  private endStream(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.runs.delete(runId)
    run.stream.close() // a clean close surfaces as `done` in the browser, not a lost stream
    // The stream dropped with no terminal event: the run is no longer live, so stop showing it as such.
    const entry = this.metas.get(runId)
    if (entry && entry.meta.status === 'running') entry.meta.status = 'stopped'
  }

  /** Stop every pump, close every stream, and forget every device target + list stub, on daemon shutdown. */
  dispose(): void {
    for (const [runId, run] of this.runs) {
      run.cancel()
      run.stream.close()
      this.runs.delete(runId)
    }
    this.targets.clear()
    this.metas.clear()
  }
}

/** Trim trailing slashes off a base URL so `${base}/_relay/...` never doubles them. */
function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}
