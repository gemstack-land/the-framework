import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { startRemoteRun, streamRemoteEvents, pingRemote, relayRpc, RelayedRuns } from './remote-run.js'
import { RUN_META_VERSION, type RunMeta } from '../store/index.js'
import type { FrameworkEvent } from '../events.js'

// A throwaway loopback server; the handler decides how it answers. Returns its base url + close.
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
  const srv: Server = createServer(handler)
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => srv.close(() => r())) }
}

// A minimal running RunMeta stub, the local list row RelayedRuns keeps for a relayed run (#1077).
function stubMeta(id: string, overrides: Partial<RunMeta> = {}): RunMeta {
  const now = new Date().toISOString()
  return { version: RUN_META_VERSION, status: 'running', id, startedAt: now, updatedAt: now, passes: 0, target: 'remote', ...overrides }
}

// Drain a RelayedRuns stream to completion, so both its `end`-driven settle and its close flip have run.
async function drainRun(runs: RelayedRuns, runId: string): Promise<void> {
  const stream = runs.get(runId)
  assert.ok(stream)
  for await (const _e of stream!) { /* consume until the device closes the body */ }
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

test('pingRemote GETs /_relay/ping with the fw_daemon cookie and is true on a 2xx (#1072)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined } = {}
  const srv = await server((req, res) => {
    captured = { method: req.method, url: req.url, cookie: req.headers.cookie }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end()
  })
  try {
    assert.equal(await pingRemote({ url: srv.url, token: 'sekret' }), true)
    assert.equal(captured.method, 'GET')
    assert.equal(captured.url, '/_relay/ping')
    assert.equal(captured.cookie, 'fw_daemon=sekret') // the #1051 cookie, daemon to daemon
  } finally {
    await srv.close()
  }
})

test('pingRemote is false on a non-2xx from the device (#1072)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('unauthorized')
  })
  try {
    assert.equal(await pingRemote({ url: srv.url, token: 'wrong' }), false)
  } finally {
    await srv.close()
  }
})

test('pingRemote is false when the device is unreachable (#1072)', async () => {
  // A port nothing is listening on: the fetch rejects, which pingRemote swallows as offline.
  assert.equal(await pingRemote({ url: 'http://127.0.0.1:1', token: 't' }), false)
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
    runs.register('r1', { url: srv.url, token: 't' }, stubMeta('r1'), 'proj-1')
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
    runs.register('r1', { url: srv.url, token: 'stale' }, stubMeta('r1'), 'proj-1')
    const stream = runs.get('r1')
    assert.ok(stream)
    const got: FrameworkEvent[] = []
    for await (const e of stream!) got.push(e)
    assert.equal(got.length, 0) // a clean close, so the browser sees `done`, not `lost`
  } finally {
    await srv.close()
  }
})

test('relayRpc posts to /_relay/rpc with the fw_daemon cookie, no Origin, and returns the device result (#1067 slice 2)', async () => {
  let captured: { method?: string | undefined; url?: string | undefined; cookie?: string | undefined; origin?: string | undefined; body: unknown } = { body: null }
  const srv = await server((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      captured = { method: req.method, url: req.url, cookie: req.headers.cookie, origin: req.headers.origin, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ result: { dirty: true, branch: 'main' } }))
    })
  })
  try {
    const result = await relayRpc({ url: srv.url, token: 'sekret' }, 'onGitStatus', ['pid', 'r1'])
    assert.deepEqual(result, { dirty: true, branch: 'main' }) // the device's own result, unwrapped from {result}
    assert.equal(captured.method, 'POST')
    assert.equal(captured.url, '/_relay/rpc')
    assert.equal(captured.cookie, 'fw_daemon=sekret') // the #1051 cookie, daemon to daemon
    assert.equal(captured.origin, undefined) // NO Origin header, so it passes the remote CSRF guard
    assert.deepEqual(captured.body, { fn: 'onGitStatus', args: ['pid', 'r1'] })
  } finally {
    await srv.close()
  }
})

test('relayRpc throws on a non-2xx from the device (#1067 slice 2)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('rpc failed')
  })
  try {
    await assert.rejects(relayRpc({ url: srv.url, token: 't' }, 'onGitStatus', []), /500|device/)
  } finally {
    await srv.close()
  }
})

test('RelayedRuns.list surfaces a relayed run as a remote row, scoped to its project (#1077)', async () => {
  // A server that never closes the body, so the pump stays live and the row stays `running` while
  // we read it synchronously; dispose() aborts the fetch on the way out.
  const srv = await server((_req, res) => res.writeHead(200, { 'content-type': 'application/x-ndjson' }))
  try {
    const runs = new RelayedRuns()
    runs.register('r1', { url: srv.url, token: 't' }, stubMeta('r1', { intent: 'do it' }), 'proj-1')
    const rows = runs.list('proj-1') // read before the fetch does anything: the stub is set synchronously
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.id, 'r1')
    assert.equal(rows[0]?.target, 'remote')
    assert.equal(rows[0]?.status, 'running')
    assert.equal(rows[0]?.intent, 'do it')
    assert.deepEqual(runs.list('other'), []) // another project sees none of it
    runs.dispose()
  } finally {
    await srv.close()
  }
})

// Register a relayed run against a device that emits one log line then an optional end line and closes,
// and return the status left on its list row once RelayedRuns has fully drained the stream (#1077).
async function relayEndStatus(endEvent: FrameworkEvent | null): Promise<string | undefined> {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'log', message: 'working' })}\n`)
    if (endEvent) res.write(`${JSON.stringify(endEvent)}\n`)
    res.end()
  })
  try {
    const runs = new RelayedRuns()
    runs.register('r1', { url: srv.url, token: 't' }, stubMeta('r1'), 'proj-1')
    await drainRun(runs, 'r1')
    return runs.list('proj-1')[0]?.status
  } finally {
    await srv.close()
  }
}

test("a relayed run's list row flips to the device's ending, or stopped if the stream just drops (#1077)", async () => {
  assert.equal(await relayEndStatus({ kind: 'end', ok: true } as FrameworkEvent), 'done')
  assert.equal(await relayEndStatus({ kind: 'end', stopped: true, ok: false } as FrameworkEvent), 'stopped')
  assert.equal(await relayEndStatus({ kind: 'end', ok: false } as FrameworkEvent), 'failed')
  assert.equal(await relayEndStatus(null), 'stopped') // no end event: the stream dropped, so it is no longer live
})

test('dispose clears the relayed run list and its device target (#1077)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.end()
  })
  try {
    const runs = new RelayedRuns()
    runs.register('r1', { url: srv.url, token: 't' }, stubMeta('r1'), 'proj-1')
    assert.equal(runs.list('proj-1').length, 1) // present before shutdown
    runs.dispose()
    assert.deepEqual(runs.list('proj-1'), []) // and gone after
    assert.equal(runs.target('r1'), undefined)
  } finally {
    await srv.close()
  }
})

test('RelayedRuns.target outlives the event stream and dispose clears it (#1067 slice 2)', async () => {
  const srv = await server((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    res.write(`${JSON.stringify({ kind: 'log', message: 'hi' })}\n`)
    res.end()
  })
  try {
    const runs = new RelayedRuns()
    const target = { url: srv.url, token: 't' }
    runs.register('r1', target, stubMeta('r1'), 'proj-1')
    const stream = runs.get('r1')
    assert.ok(stream)
    for await (const _e of stream!) { /* drain until the device closes the body, ending the pump */ }
    assert.equal(runs.get('r1'), undefined) // the event stream is gone once the device closes
    assert.deepEqual(runs.target('r1'), target) // but the device target outlives it, for a post-run push/PR
    runs.dispose()
    assert.equal(runs.target('r1'), undefined) // cleared on shutdown
  } finally {
    await srv.close()
  }
})
