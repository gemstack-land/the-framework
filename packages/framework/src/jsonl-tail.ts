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
