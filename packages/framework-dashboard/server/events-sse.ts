import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { listProjects, FRAMEWORK_DIR, EVENTS_FILE } from '@gemstack/framework'

/**
 * Spike (#406): a dev-server SSE endpoint that streams a project's live run, read
 * straight from the same `.the-framework/events.jsonl` the daemon writes — no
 * daemon process, no run<->dashboard IPC, the file is the seam. #405 pairs SSE with
 * Telefunc-stream for events; this is the SSE half, robust and matching today's
 * daemon. Projects come the other way, over a Telefunc RPC (projects.telefunc.ts).
 *
 * `GET /api/events?project=<id>` seeds the client with what is already logged, then
 * tails appends (an `fs.watch` plus a poll backstop, since `fs.watch` is unreliable
 * across platforms). Each JSONL line is forwarded verbatim as one SSE `data:` frame.
 */
export function eventsSse(): Plugin {
  return {
    name: 'the-framework-dashboard:events-sse',
    configureServer(server) {
      server.middlewares.use('/api/events', (req, res) => void handle(req, res))
    },
  }
}

async function resolveEventsPath(projectId: string | null): Promise<string | undefined> {
  if (!projectId) return undefined
  const projects = await listProjects().catch(() => [])
  const project = projects.find(p => p.id === projectId)
  return project ? join(project.path, FRAMEWORK_DIR, EVENTS_FILE) : undefined
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('project')
  const path = await resolveEventsPath(projectId)
  if (!path) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('unknown or missing project')
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(': connected\n\n') // open the stream immediately

  // Offset-based tail: forward only bytes appended since the last read, holding a
  // torn trailing line until its newline arrives. A truncate (fresh run) resets us.
  let offset = 0
  let buffer = ''
  let pulling = false
  const pull = async (): Promise<void> => {
    if (pulling) return
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
        if (line.trim()) res.write(`data: ${line}\n\n`)
      }
    } finally {
      pulling = false
    }
  }

  await pull()
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(join(path, '..'), () => void pull())
  } catch {
    // dir may not be watchable everywhere; the poll backstop still covers it
  }
  const poll = setInterval(() => void pull(), 1000)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000) // keep proxies from idling us out

  req.on('close', () => {
    clearInterval(poll)
    clearInterval(heartbeat)
    watcher?.close()
    res.end()
  })
}
