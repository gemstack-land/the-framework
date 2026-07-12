import { join } from 'node:path'
import { Channel, type ClientChannel } from 'telefunc'
import {
  defaultProjectsProvider,
  FRAMEWORK_DIR,
  EVENTS_FILE,
  type FrameworkEvent,
} from '@gemstack/framework'
import { tailEvents } from './events-tail.js'

// The live event stream over Telefunc (#405): the selected project's run, read
// straight from the same `.the-framework/events.jsonl` the daemon writes. Each new
// JSONL line becomes one `channel.send(event)`, so the file watcher maps 1:1 onto a
// Telefunc Channel — serialization, type validation, and reconnect come for free
// (replaces the custom SSE endpoint the spike used, per Dani's note on #405). Runs,
// docs, and the project log come over the read-model RPCs (reads.telefunc.ts).

/** The events file for a project id, or undefined when the project is unknown. */
async function resolveEventsPath(projectId: string): Promise<string | undefined> {
  const path = await defaultProjectsProvider().resolvePath(projectId)
  return path ? join(path, FRAMEWORK_DIR, EVENTS_FILE) : undefined
}

/**
 * `onEvents(projectId)` returns a Channel that streams the project's live run: the
 * client `.listen()`s for `FrameworkEvent`s and `.close()`s to unsubscribe, which
 * stops the file tail. An unknown project yields a channel that closes immediately
 * (mirrors the read model's empty results rather than throwing at the client).
 */
export async function onEvents(projectId: string): Promise<ClientChannel<never, FrameworkEvent>> {
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
