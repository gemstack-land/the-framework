import { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from '../events.js'
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
 * from the remote. This map is the only place a saved device's token lives daemon-side: in memory,
 * for the run's lifetime, dropped the moment the remote stream ends.
 */
export class RelayedRuns {
  private readonly runs = new Map<string, RelayedRun>()

  /** Open a local stream for a remote run and start pumping the remote's events into it. */
  register(runId: string, target: RemoteTarget): void {
    this.runs.get(runId)?.cancel() // a re-register (same id) replaces the old pump
    const stream = new EventStream<FrameworkEvent>()
    const cancel = streamRemoteEvents(target, runId, event => stream.push(event), () => this.drop(runId))
    this.runs.set(runId, { target, stream, cancel })
  }

  /** The live event stream for a relayed run, or undefined when this daemon is not relaying it. */
  get(runId: string | undefined): EventStream<FrameworkEvent> | undefined {
    return runId ? this.runs.get(runId)?.stream : undefined
  }

  /** Close a relayed run's stream and forget its token. Idempotent. */
  private drop(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    this.runs.delete(runId)
    run.stream.close() // a clean close surfaces as `done` in the browser, not a lost stream
  }

  /** Stop every pump and close every stream, on daemon shutdown. */
  dispose(): void {
    for (const [runId, run] of this.runs) {
      run.cancel()
      run.stream.close()
      this.runs.delete(runId)
    }
  }
}

/** Trim trailing slashes off a base URL so `${base}/_relay/...` never doubles them. */
function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}
