import { dirname } from 'node:path'
import { JsonlTailer, followFile } from '../jsonl-tail.js'

/** How often the poll backstop re-reads the log when `fs.watch` says nothing. */
const POLL_MS = 1000

/**
 * Tail a `.the-framework/events.jsonl`: read what is already logged, then follow
 * appends. Each complete JSONL line is parsed and handed to `onEvent`; malformed
 * lines are skipped. Returns a stop function that removes the watcher and the poll.
 *
 * The reading is {@link JsonlTailer} and the following is {@link followFile}, the same
 * two pieces the run's control tail is built from. This used to be its own copy of both,
 * which is how it ended up missing the tailer's same-length-rewrite detection (#567).
 *
 * Kept transport-agnostic (a plain `onEvent` callback, not a channel) so the file
 * side can be driven on its own; events.telefunc.ts wires it to a Telefunc Channel.
 */
export function tailEvents<T = unknown>(path: string, onEvent: (event: T) => void): () => void {
  const tailer = new JsonlTailer<T>(path, onEvent)
  return followFile(dirname(path), () => tailer.pull(), { pollMs: POLL_MS })
}
