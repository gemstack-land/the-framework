/**
 * Forward an async-iterable of events to a `send` sink until the source is exhausted or
 * the returned stop function is called (#426). This is the bridge behind the relay's
 * `onEvents`: the relay's in-memory run is an `AsyncIterable` that replays its buffered
 * history then follows live (exactly what `serveSSE` consumes), and each value becomes a
 * `channel.send(event)`. Kept transport-agnostic (a plain `send` callback, not a Channel)
 * so the pump can be driven and tested on its own; events.telefunc.ts wires the Channel.
 *
 * Returns a stop function that halts forwarding and cancels the iterator, releasing the
 * follower waiting on the next event. Idempotent. An absent source is a no-op.
 */
export function forwardStream<T>(iterable: AsyncIterable<T> | undefined, send: (value: T) => void): () => void {
  if (!iterable) return () => {}
  const iterator = iterable[Symbol.asyncIterator]()
  let stopped = false
  void (async () => {
    try {
      for (let next = await iterator.next(); !next.done && !stopped; next = await iterator.next()) {
        if (!stopped) send(next.value)
      }
    } catch {
      // the stream closed or the consumer went away
    }
  })()
  return () => {
    stopped = true
    void iterator.return?.()
  }
}
