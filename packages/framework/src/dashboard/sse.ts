import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EventStream } from '@gemstack/ai-autopilot'
import type { FrameworkEvent } from '../events.js'

/**
 * Serve one client the {@link FrameworkEvent} stream over Server-Sent Events:
 * replay the whole run's history, then follow live. A fresh async iterator gives
 * this client its own cursor from the start, so a late browser still sees the run
 * from the beginning. Shared by the localhost dashboard and the hosted relay (#230)
 * so both project the identical stream.
 */
export function serveSSE(
  req: IncomingMessage,
  res: ServerResponse,
  stream: EventStream<FrameworkEvent>,
  clients: Set<ServerResponse>,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  clients.add(res)

  const send = (event: FrameworkEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`)
  void (async () => {
    try {
      for await (const event of stream[Symbol.asyncIterator]()) send(event)
    } catch {
      // client went away
    } finally {
      clients.delete(res)
      res.end()
    }
  })()

  req.on('close', () => {
    clients.delete(res)
    res.end()
  })
}
