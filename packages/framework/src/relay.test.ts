import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRelay, relayPublisher } from './relay.js'
import type { FrameworkEvent } from './events.js'

function fetchFull(
  url: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body }))
    }).on('error', rejectPromise)
  })
}

function send(
  url: string,
  method: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method, headers }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', rejectPromise)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** POST an `onEvents` call to the relay's Telefunc mount, the dashboard's live-stream RPC. */
function callOnEvents(base: string, runId: string, origin?: string): Promise<{ status: number; body: string }> {
  return send(
    `${base}/_telefunc`,
    'POST',
    JSON.stringify({ file: '/server/events.telefunc.ts', name: 'onEvents', args: [runId] }),
    { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
  )
}

const local = { host: '127.0.0.1', port: 0 as const }

/** A temp dir holding a minimal SPA `index.html`, to exercise bundle serving offline. */
async function fakeBundle(marker: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-bundle-'))
  await writeFile(join(dir, 'index.html'), `<!doctype html><title>The Framework</title><!-- ${marker} -->`)
  return dir
}

test('a viewer GET of a run redirects to the SPA viewer URL /?run=:id (#426)', async () => {
  const relay = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    for (const path of ['/r/xyz', '/r/xyz/']) {
      const redirect = await fetchFull(`${relay.url}${path}`)
      assert.equal(redirect.status, 302)
      assert.equal(redirect.headers.location, '/?run=xyz')
    }
  } finally {
    await relay.close()
  }
})

test('the relay serves the dashboard SPA at / (and its viewer URL); missing bundle is a clean 404', async () => {
  const bundle = await fakeBundle('spa-here')
  const served = await startRelay({ ...local, clientBundleDir: bundle })
  try {
    const root = await fetchFull(`${served.url}/`)
    assert.equal(root.status, 200)
    assert.match(root.body, /spa-here/) // the SPA index.html, not page.ts
    const viewer = await fetchFull(`${served.url}/?run=abc`)
    assert.equal(viewer.status, 200)
    assert.match(viewer.body, /spa-here/) // ?run= is a client concern; same shell is served
  } finally {
    await served.close()
  }

  const bare = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    const root = await fetchFull(`${bare.url}/`)
    assert.equal(root.status, 404)
    assert.match(root.body, /not built/)
  } finally {
    await bare.close()
  }
})

test('onEvents is mounted and streams a run; cross-origin is rejected (#426)', async () => {
  const relay = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    relay.ingest('run-1', { kind: 'log', message: 'a' })
    // A same-origin viewer call returns a live Telefunc Channel for the run (not a 404).
    const ok = await callOnEvents(relay.url, 'run-1', relay.url)
    assert.equal(ok.status, 200)
    assert.match(ok.body, /TelefuncChannel/)
    // A cross-origin POST is refused: the relay is public, only its own page may call it.
    const evil = await callOnEvents(relay.url, 'run-1', 'http://evil.com')
    assert.equal(evil.status, 403)
  } finally {
    await relay.close()
  }
})

test('runs are isolated by id and tracked', async () => {
  const relay = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    relay.ingest('run-a', { kind: 'log', message: 'only-a' })
    relay.ingest('run-b', { kind: 'log', message: 'only-b' })
    assert.deepEqual(relay.runIds().sort(), ['run-a', 'run-b'])
  } finally {
    await relay.close()
  }
})

test('relayPublisher shares the SPA viewer URL and ingests over /r/:id/publish', async () => {
  const relay = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    const pub = relayPublisher(relay.url, 'pub')
    assert.equal(pub.url, `${relay.url}/?run=pub`) // the shareable viewer URL, not /r/pub/
    pub.publish({ kind: 'log', message: 'from-cli-1' })
    pub.publish({ kind: 'end', ok: true } as FrameworkEvent)
    await pub.flush()
    assert.deepEqual(relay.runIds(), ['pub']) // the events landed in the run's stream
  } finally {
    await relay.close()
  }
})

test('run count is bounded: least-recently-used runs are evicted at maxRuns (#230 hardening)', async () => {
  const relay = await startRelay({ ...local, maxRuns: 2, clientBundleDir: '/no/such/bundle' })
  try {
    relay.ingest('a', { kind: 'log', message: '1' })
    relay.ingest('b', { kind: 'log', message: '1' })
    relay.ingest('a', { kind: 'log', message: '2' }) // touch a → a is now most-recent
    relay.ingest('c', { kind: 'log', message: '1' }) // over cap → evict the LRU, which is b (not a)
    assert.deepEqual(relay.runIds().sort(), ['a', 'c'])
  } finally {
    await relay.close()
  }
})

test('relayPublisher does not hang flush() when the relay accepts but never responds (#230 hardening)', async () => {
  // A server that accepts the TCP connection and the request but never replies.
  const stall = createNetServer(() => {})
  await new Promise<void>(r => stall.listen(0, '127.0.0.1', () => r()))
  const port = (stall.address() as { port: number }).port
  try {
    const errors: unknown[] = []
    const pub = relayPublisher(`http://127.0.0.1:${port}`, 'x', e => errors.push(e), 250)
    pub.publish({ kind: 'log', message: 'hi' })
    await pub.flush() // must resolve (via the fetch timeout), not hang forever
    assert.equal(errors.length, 1) // the timed-out POST surfaced as an error, best-effort
  } finally {
    stall.close()
  }
})

test('relayPublisher reports a rejected publish, which fetch resolves rather than throws (#575)', async () => {
  // maxBodyBytes small enough that one event trips the relay's 413.
  const relay = await startRelay({ ...local, maxBodyBytes: 512, clientBundleDir: '/no/such/bundle' })
  try {
    const errors: unknown[] = []
    const pub = relayPublisher(relay.url, 'over-cap', e => errors.push(e))
    pub.publish({ kind: 'log', message: 'x'.repeat(2000) })
    await pub.flush()
    assert.equal(errors.length, 1) // an error STATUS is a failed POST, same as a thrown fetch
    assert.match(String(errors[0]), /413/)
  } finally {
    await relay.close()
  }
})

test('relayPublisher keeps publishing after a rejected event, and stays quiet when accepted (#575)', async () => {
  const relay = await startRelay({ ...local, maxBodyBytes: 512, clientBundleDir: '/no/such/bundle' })
  try {
    const errors: unknown[] = []
    const pub = relayPublisher(relay.url, 'mixed', e => errors.push(e))
    pub.publish({ kind: 'log', message: 'x'.repeat(2000) }) // rejected: 413
    pub.publish({ kind: 'log', message: 'small' }) // accepted: 202
    await pub.flush()
    assert.equal(errors.length, 1) // only the rejected one reported; best-effort, the run goes on
    assert.deepEqual(relay.runIds(), ['mixed'])
  } finally {
    await relay.close()
  }
})

test('healthz is 200; a bad publish is rejected without crashing the run', async () => {
  const relay = await startRelay({ ...local, clientBundleDir: '/no/such/bundle' })
  try {
    assert.equal((await fetchFull(`${relay.url}/healthz`)).status, 200)
    assert.equal((await send(`${relay.url}/r/x/publish`, 'GET')).status, 405) // must POST
    assert.equal((await send(`${relay.url}/r/x/publish`, 'POST', 'not json')).status, 400)
    const ok = await send(`${relay.url}/r/x/publish`, 'POST', JSON.stringify({ kind: 'log', message: 'ok' }))
    assert.equal(ok.status, 202)
  } finally {
    await relay.close()
  }
})
