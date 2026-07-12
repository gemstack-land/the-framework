import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Tail a `.the-framework/events.jsonl`: read what is already logged, then follow
 * appends. Each complete JSONL line is parsed and handed to `onEvent`; malformed
 * lines are skipped. Offset-based so only new bytes are read, holding a torn trailing
 * line until its newline arrives; a truncate (a fresh run reusing the file) resets us.
 * An `fs.watch` drives it, with a 1s poll backstop since `fs.watch` is unreliable
 * across platforms. Returns a stop function that removes the watcher and the poll.
 *
 * Kept transport-agnostic (a plain `onEvent` callback, not a channel) so the file
 * side can be driven on its own; events.telefunc.ts wires it to a Telefunc Channel.
 */
export function tailEvents<T = unknown>(path: string, onEvent: (event: T) => void): () => void {
  let offset = 0
  let buffer = ''
  let pulling = false
  let stopped = false

  const pull = async (): Promise<void> => {
    if (pulling || stopped) return
    pulling = true
    try {
      const size = await stat(path).then(s => s.size).catch(() => -1)
      if (size < 0) return // file not created yet
      if (size < offset) {
        offset = 0
        buffer = ''
      }
      if (size === offset) return
      const fh = await open(path, 'r')
      try {
        const length = size - offset
        const chunk = Buffer.alloc(length)
        await fh.read(chunk, 0, length, offset)
        offset = size
        buffer += chunk.toString('utf8')
      } finally {
        await fh.close()
      }
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? '' // last element is the (possibly empty) trailing fragment
      for (const line of lines) {
        if (!line.trim()) continue
        let event: T
        try {
          event = JSON.parse(line) as T
        } catch {
          continue // a malformed line never breaks the stream
        }
        onEvent(event)
      }
    } finally {
      pulling = false
    }
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dirname(path), () => void pull())
  } catch {
    // dir may not be watchable everywhere; the poll backstop still covers it
  }
  const poll = setInterval(() => void pull(), 1000)
  void pull() // seed with whatever is already logged

  return () => {
    stopped = true
    clearInterval(poll)
    watcher?.close()
  }
}
