import { watch, type FSWatcher } from 'node:fs'
import { open } from 'node:fs/promises'

/**
 * Tails an append-only JSONL log, calling `onLine` for each complete line as it
 * is written. Reads only the bytes appended since the last {@link pull},
 * buffering a torn trailing line until its newline arrives. A file that shrinks
 * (a fresh run truncated the log) resets to the start so the new content is
 * picked up. The generic base behind the daemon's event tail and the run's
 * control tail (#344) — one tailer, two directions.
 */
export class JsonlTailer<T> {
  private offset = 0
  private partial = ''
  private lastMtimeMs = 0

  constructor(
    private readonly path: string,
    private readonly onLine: (value: T) => void,
  ) {}

  /** Read and dispatch any lines appended since the previous call. */
  async pull(): Promise<void> {
    let fd
    try {
      fd = await open(this.path, 'r')
    } catch {
      return // not created yet (nothing has written)
    }
    try {
      const { size, mtimeMs } = await fd.stat()
      // A fresh run truncates the log in place (same inode). Detect it two ways: the
      // file shrank below what we consumed, or it was rewritten to the same length
      // (size unchanged but mtime advanced). Either way, re-read from the top.
      const rewritten = size === this.offset && this.offset > 0 && mtimeMs > this.lastMtimeMs
      if (size < this.offset || rewritten) {
        this.offset = 0
        this.partial = ''
      }
      this.lastMtimeMs = mtimeMs
      if (size === this.offset) return
      const buf = Buffer.alloc(size - this.offset)
      await fd.read(buf, 0, buf.length, this.offset)
      this.offset = size
      this.partial += buf.toString('utf8')
      const lines = this.partial.split('\n')
      this.partial = lines.pop() ?? '' // trailing fragment with no newline yet
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          this.onLine(JSON.parse(trimmed) as T)
        } catch {
          // a torn/half-written line — skip it; the log never rewrites history
        }
      }
    } finally {
      await fd.close()
    }
  }
}

/** Options for {@link followFile}. */
export interface FollowFileOptions {
  /** How often the backstop poll runs. */
  pollMs: number
  /** Let the process exit with the poll still scheduled (steering must never hold it open). */
  unref?: boolean
}

/**
 * Drive a {@link JsonlTailer} as the file grows: an `fs.watch` on `dir` for latency, plus a
 * poll backstop because `fs.watch` is unreliable across platforms. Pulls are serialized (a
 * pull already in flight swallows the next trigger) and stop for good once the returned
 * function is called. Shared by the run's control tail and the dashboard's event tail, which
 * hand-rolled this separately and drifted apart.
 *
 * Nothing here may throw at the process: a failed pull and a watcher error are both survivable,
 * and the poll alone is a complete tail (#996).
 */
export function followFile(dir: string, pull: () => Promise<void>, opts: FollowFileOptions): () => void {
  let pulling = false
  let stopped = false
  const pump = async (): Promise<void> => {
    if (pulling || stopped) return
    pulling = true
    try {
      await pull()
    } catch {
      // #996: every caller discards this promise, so a rejected read (EIO on a network mount,
      // EISDIR, a log grown past kMaxLength) would be an unhandled rejection and kill the
      // process. Swallowed rather than logged: the next tick retries, and a fault that persists
      // would otherwise print once per poll forever.
    } finally {
      pulling = false
    }
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(dir, () => void pump())
    // #996: an 'error' with no listener throws out of the emitter, which is the same process
    // death. The watcher is spent once it errors (node closes the handle first), so drop it and
    // let the poll below carry the tail on its own.
    watcher.on('error', () => {
      watcher?.close()
      watcher = undefined
    })
  } catch {
    // dir may not be watchable everywhere; the poll backstop still covers it
  }
  const poll = setInterval(() => void pump(), opts.pollMs)
  if (opts.unref) poll.unref()
  void pump() // seed with whatever is already written

  return () => {
    stopped = true
    clearInterval(poll)
    watcher?.close()
    watcher = undefined
  }
}
