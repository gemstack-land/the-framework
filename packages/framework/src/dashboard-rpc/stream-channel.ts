import { Channel, type ClientChannel } from 'telefunc'

/**
 * Wrap a live source in a Telefunc Channel (#405/#426): open the channel, hand `start` a
 * `send` sink, and let it wire the source and hand back a stop function. When `start`
 * returns undefined — an unknown project with nothing to stream — the channel closes
 * immediately, mirroring the read model's empty results rather than throwing at the client;
 * otherwise the stop runs on `.close()`. This owns the whole Channel lifecycle so the
 * callers (events.telefunc.ts) read as "stream from this source" with no channel plumbing.
 */
export function streamChannel<T>(start: (send: (value: T) => void) => (() => void) | undefined): ClientChannel<never, T> {
  const channel = new Channel<never, T>()
  // `as never`: telefunc's ChannelData<T> wrapper doesn't resolve for a free type param
  // (it does for a concrete event type); the sink is plain `T` for every caller.
  const stop = start(value => void channel.send(value as never))
  if (stop) channel.onClose(stop)
  else void channel.close()
  return channel.client
}

/**
 * Forward an async-iterable of events to a `send` sink until the source is exhausted or
 * the returned stop function is called (#426). This is the bridge behind the relay's
 * `onEvents`: the relay's in-memory run is an `AsyncIterable` that replays its buffered
 * history then follows live (exactly what `serveSSE` consumes), and each value becomes a
 * `channel.send(event)`. Kept transport-agnostic (a plain `send` callback, not a Channel)
 * so the pump can be driven and tested on its own; {@link streamChannel} wires the Channel.
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
        send(next.value)
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
