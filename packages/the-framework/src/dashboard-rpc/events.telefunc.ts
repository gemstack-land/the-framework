import { join } from 'node:path'
import type { ClientChannel } from 'telefunc'
import { FRAMEWORK_DIR, EVENTS_FILE } from '../store/index.js'
import { contextEventsSource, resolveRunPath } from './context.js'
import type { FrameworkEvent } from '../events.js'
import { tailEvents } from './events-tail.js'
import { forwardStream, streamChannel } from './stream-channel.js'

// The live event stream behind the new dashboard (#405): the selected project's run,
// read straight from the same `.the-framework/events.jsonl` the daemon writes. Each new
// JSONL line becomes one `channel.send(event)`, so the file watcher maps 1:1 onto a
// Telefunc Channel — serialization, type validation, and reconnect come for free. Runs,
// docs, and the project log come over the read-model RPCs (reads.telefunc.ts).

/**
 * The events file to tail, or undefined when the project is unknown. With a `runId` this is
 * that run's own log inside its worktree (#749): since #736 a run appends there, not to the
 * project root, so streaming the project path would follow a file nothing writes to.
 */
async function resolveEventsPath(projectId: string, runId?: string): Promise<string | undefined> {
  const path = await resolveRunPath(projectId, runId)
  return path ? join(path, FRAMEWORK_DIR, EVENTS_FILE) : undefined
}

/**
 * `onEvents(projectId, runId?)` returns a Channel that streams one live run: the client
 * `.listen()`s for `FrameworkEvent`s and `.close()`s to unsubscribe, which stops the tail.
 * An unknown project yields a channel that closes immediately (mirrors the read model's
 * empty results rather than throwing at the client).
 *
 * Pass the `runId` to follow that run's own log (#749). A project has several concurrent
 * runs since #736, each writing inside its worktree, so the run id is what makes the feed
 * that run's rather than a mix — and without it the feed for a worktree run is empty.
 * Omitting it keeps the pre-#736 behavior of tailing the project root.
 *
 * Two sources, chosen by the mount. An in-memory stream on the context wins: the relay's own run
 * (#426), or a run the daemon is relaying from a device (#1067). Otherwise the on-disk log. The
 * daemon sets a source that answers only for relayed runs, so an ordinary local run yields undefined
 * here and falls through to tailing the log, exactly as before.
 */
export async function onEvents(projectId: string, runId?: string): Promise<ClientChannel<never, FrameworkEvent>> {
  const stream = contextEventsSource()?.(projectId, runId)
  if (stream) {
    // An in-memory run: replay + follow it, mirroring how serveSSE consumes it.
    return streamChannel<FrameworkEvent>(send => forwardStream(stream, send))
  }
  // Everywhere else: tail the run's on-disk events.jsonl (undefined path -> closed channel).
  const path = await resolveEventsPath(projectId, runId)
  return streamChannel<FrameworkEvent>(send => (path ? tailEvents(path, send) : undefined))
}
