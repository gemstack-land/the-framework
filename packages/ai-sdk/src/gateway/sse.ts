/**
 * A single Server-Sent Event frame, parsed from a `text/event-stream` body.
 *
 * Only the two fields LLM gateways use in practice are surfaced: the optional
 * `event:` name and the (possibly multi-line) `data:` payload. Comment lines
 * (`:`-prefixed) and `id:` / `retry:` fields are consumed and ignored.
 */
export interface SseEvent {
  /** The `event:` field, if the frame declared one. */
  event?: string | undefined
  /** The concatenated `data:` payload (multiple `data:` lines joined by `\n`). */
  data: string
}

/**
 * Frame a `text/event-stream` response body into {@link SseEvent}s.
 *
 * Standalone and dependency-free so the gateway template ships its own
 * framing — every built-in chat provider streams through a vendor SDK, so
 * there is no shared framer to reuse. Handles `\n` and `\r\n` line endings,
 * multi-line `data:` payloads, and back-pressure-friendly chunk boundaries
 * (an event split across two network reads is buffered until complete).
 *
 * Aborts cleanly: when `signal` fires, the reader is cancelled and iteration
 * ends. A trailing event with no terminating blank line is still yielded once
 * the stream closes.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const onAbort = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Events are separated by a blank line. Normalize CRLF to LF first so a
      // single split handles both endings.
      let sep: number
      buffer = buffer.replace(/\r\n/g, '\n')
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const event = parseFrame(raw)
        if (event) yield event
      }
    }

    // Flush a final frame that arrived without a trailing blank line.
    const tail = (buffer + decoder.decode()).replace(/\r\n/g, '\n').trim()
    if (tail) {
      const event = parseFrame(tail)
      if (event) yield event
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

/** Parse one raw SSE frame (the text between blank-line separators). */
function parseFrame(raw: string): SseEvent | null {
  let event: string | undefined
  const dataLines: string[] = []

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // blank or comment
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // Per spec, a single leading space after the colon is stripped.
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    // id / retry / unknown fields ignored
  }

  if (dataLines.length === 0 && event === undefined) return null
  return { ...(event !== undefined ? { event } : {}), data: dataLines.join('\n') }
}
