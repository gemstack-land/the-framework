import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { startRemoteRun, streamRemoteEvents, RelayedRuns } from './remote-run.js'
import type { FrameworkEvent } from '../events.js'

// A throwaway loopback server; the handler decides how it answers. Returns its base url + close.
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: Server = createServer(handler)
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => srv.close(() => r())) }
}

/** Wait until the stream ends (its `onEnd` fires) or a timeout trips, collecting events meanwhile. */
function drain(target: { url: string; token: string }, runId: string, timeoutMs = 4000): Promise<{ events: FrameworkEvent[]; ended: boolean }> {
  return new Promise(resolvePromise => {
    const events: FrameworkEvent[] = []
    const timer = setTimeout(() => resolvePromise({ events, ended: false }), timeoutMs)
    streamRemoteEvents(target, runId, e => events.push(e), () => {
      clearTimeout(timer)
      resolvePromise({ events, ended: true })
    })
  })
}

test('startRemoteRun posts to /_relay/start with the fw_daemon cookie, no Origin, and the run body (#1067)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, runId: 'r1' }))
    })
  })
  try {
    const result = await startRemoteRun({ url: srv.url, token: 'sekret' }, { prompt: 'do it', kind: 'build', options: { autopilot: true } })
    assert.deepEqual(result, { ok: true, runId: 'r1' })
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/start')
    assert.equal(captured.cookie, 'fw_daemon=sekret') // the #1051 cookie, daemon to daemon
    assert.equal(captured.origin, undefined) // NO Origin header, so it passes the remote CSRF guard
    assert.deepEqual(captured.body, { prompt: 'do it', kind: 'build', options: { autopilot: true } })
  } finally {
    await srv.close()
  }
})

test('startRemoteRun surfaces a non-2xx from the device as an ok:false result (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    const result = await startRemoteRun({ url: srv.url, token: 'wrong' }, { prompt: 'x', kind: 'build', options: {} })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /403|device/)
  } finally {
    await srv.close()
  }
})

test('streamRemoteEvents parses ndjson lines in order and ends when the body closes (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'log', message: 'a' })}\n`)
    res.write(`${JSON.stringify({ kind: 'log', message: 'b' })}\n`)
    res.end()
  })
  try {
    const { events, ended } = await drain({ url: srv.url, token: 't' }, 'r1')
    assert.deepEqual(events.map(e => (e as { message?: string }).message), ['a', 'b'])
    assert.equal(ended, true)
  } finally {
    await srv.close()
  }
})

test('a line split across two chunks is reassembled, not dropped (#1067)', async () => {
  const line = `${JSON.stringify({ kind: 'log', message: 'split' })}\n`
  const srv = await server(async (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(line.slice(0, 10)) // half a JSON line
    await new Promise(r => setTimeout(r, 20))
    res.write(line.slice(10)) // the rest, arriving in a second chunk
    res.end()
  })
  try {
    const { events } = await drain({ url: srv.url, token: 't' }, 'r1')
    assert.deepEqual(events.map(e => (e as { message?: string }).message), ['split'])
  } finally {
    await srv.close()
  }
})

test('a 401 from the remote (rotated token) surfaces as a clean stream-end, no events (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    const { events, ended } = await drain({ url: srv.url, token: 'stale' }, 'r1')
    assert.equal(events.length, 0)
    assert.equal(ended, true) // ended cleanly (a done), not an error the caller has to retry
  } finally {
    await srv.close()
  }
})

test('RelayedRuns feeds a run stream from the device and drops its token when the stream ends (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'log', message: 'hi' })}\n`)
    res.end()
  })
  try {
    const runs = new RelayedRuns()
    runs.register('r1', { url: srv.url, token: 't' })
    const stream = runs.get('r1') // grabbed synchronously, before the remote stream ends
    assert.ok(stream)
    const got: FrameworkEvent[] = []
    for await (const e of stream!) got.push(e) // replays, then ends when the device closes the body
    assert.deepEqual(got.map(e => (e as { message?: string }).message), ['hi'])
    assert.equal(runs.get('r1'), undefined) // dropped: the token no longer lives here
  } finally {
    await srv.close()
  }
})

test('RelayedRuns closes cleanly on a 401 with no events (#1067)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401)
    res.end()
  })
  try {
    const runs = new RelayedRuns()
    runs.register('r1', { url: srv.url, token: 'stale' })
    const stream = runs.get('r1')
    assert.ok(stream)
    const got: FrameworkEvent[] = []
    for await (const e of stream!) got.push(e)
    assert.equal(got.length, 0) // a clean close, so the browser sees `done`, not `lost`
  } finally {
    await srv.close()
  }
})
