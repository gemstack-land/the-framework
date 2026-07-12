import { join } from 'node:path'
import { Channel, type ClientChannel } from 'telefunc'
import { FRAMEWORK_DIR, EVENTS_FILE } from '../store/index.js'
import { contextProjects, contextEventsSource } from './context.js'
import type { FrameworkEvent } from '../events.js'
import { tailEvents } from './events-tail.js'
import { forwardStream } from './stream-channel.js'

// The live event stream behind the new dashboard (#405): the selected project's run,
// read straight from the same `.the-framework/events.jsonl` the daemon writes. Each new
// JSONL line becomes one `channel.send(event)`, so the file watcher maps 1:1 onto a
// Telefunc Channel — serialization, type validation, and reconnect come for free. Runs,
// docs, and the project log come over the read-model RPCs (reads.telefunc.ts).

/** The events file for a project id, or undefined when the project is unknown. */
async function resolveEventsPath(projectId: string): Promise<string | undefined> {
  const path = await contextProjects().resolvePath(projectId)
  return path ? join(path, FRAMEWORK_DIR, EVENTS_FILE) : undefined
}

/**
 * `onEvents(projectId)` returns a Channel that streams the project's live run: the
 * client `.listen()`s for `FrameworkEvent`s and `.close()`s to unsubscribe, which
 * stops the tail. An unknown project yields a channel that closes immediately
 * (mirrors the read model's empty results rather than throwing at the client).
 *
 * Two sources, chosen by the mount: the relay (#426) streams from an in-memory run on
 * the context; everywhere else there is no such source, so it tails the project's
 * `.the-framework/events.jsonl` on disk.
 */
export async function onEvents(projectId: string): Promise<ClientChannel<never, FrameworkEvent>> {
  const source = contextEventsSource()
  if (source) {
    // The relay: replay + follow its in-memory run, mirroring how serveSSE consumes it.
    const stream = source(projectId)
    const channel = new Channel<never, FrameworkEvent>()
    if (!stream) {
      void channel.close()
      return channel.client
    }
    const stop = forwardStream(stream, event => void channel.send(event))
    channel.onClose(stop)
    return channel.client
  }

  const channel = new Channel<never, FrameworkEvent>()
  const path = await resolveEventsPath(projectId)
  if (!path) {
    void channel.close()
    return channel.client
  }
  const stop = tailEvents<FrameworkEvent>(path, event => void channel.send(event))
  channel.onClose(stop)
  return channel.client
}
