import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDashboard } from './server.js'
import { isSameOriginRequest } from './telefunc-serve.js'
import type { FrameworkEvent } from '../events.js'
import type { StartRunKind, StartRunOptions, StartRunResult } from './types.js'
import type { IncomingMessage } from 'node:http'

function fetchText(url: string): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () =>
        resolvePromise({ status: res.statusCode ?? 0, body, type: String(res.headers['content-type'] ?? '') }),
      )
    }).on('error', rejectPromise)
  })
}

// Like fetchText, but with an optional Cookie header and the response's Set-Cookie / Location back.
function fetchAuth(
  url: string,
  cookie?: string,
): Promise<{ status: number; body: string; setCookie?: string | undefined; location?: string | undefined }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, { headers: cookie ? { cookie } : {} }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () =>
        resolvePromise({
          status: res.statusCode ?? 0,
          body,
          setCookie: res.headers['set-cookie']?.[0],
          location: res.headers.location,
        }),
      )
    }).on('error', rejectPromise)
  })
}

/** Send a raw request line over a socket — for request targets `http.get` refuses to send. */
function rawRequest(url: string, requestLine: string): Promise<string> {
  const port = Number(new URL(url).port)
  return new Promise((resolvePromise, rejectPromise) => {
    const sock = connect(port, '127.0.0.1', () => {
      sock.write(`${requestLine}\r\nHost: x\r\nConnection: close\r\n\r\n`)
    })
    let data = ''
    sock.on('data', c => (data += c))
    sock.on('close', () => resolvePromise(data))
    sock.on('error', rejectPromise)
    sock.setTimeout(5000, () => sock.destroy())
  })
}

// A cross-origin POST: an `Origin` header for a host that is not this server.
function postCrossOrigin(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers: { origin: 'http://evil.com', 'content-type': 'application/json' } }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', rejectPromise)
    req.end('{}')
  })
}

// A minimal prerendered SPA bundle: an index.html shell + one hashed asset.
async function fakeBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dash-bundle-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log("app")')
  return dir
}

test('without a bundle the server reports the dashboard is not installed (503)', async () => {
  const dash = await startDashboard({ port: 0 })
  try {
    const { status, body } = await fetchText(dash.url + '/')
    assert.equal(status, 503)
    assert.match(body, /not installed/)
  } finally {
    await dash.close()
  }
})

test('serves the prerendered SPA shell at / and hashed assets, with an SPA fallback', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle })
  try {
    const root = await fetchText(dash.url + '/')
    assert.equal(root.status, 200)
    assert.match(root.body, /<div id="root">/)

    const asset = await fetchText(dash.url + '/assets/app.js')
    assert.equal(asset.status, 200)
    assert.match(asset.type, /javascript/)

    // An unknown client route falls back to the SPA shell (client-side routing).
    const deep = await fetchText(dash.url + '/some/client/route')
    assert.equal(deep.status, 200)
    assert.match(deep.body, /<div id="root">/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('a malformed percent-encoded path serves the SPA shell and the server survives (#938)', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle })
  try {
    // `decodeURIComponent('/%zz')` throws; unguarded it is an unhandled rejection that kills the process.
    const bad = await fetchText(dash.url + '/%zz')
    assert.equal(bad.status, 200)
    assert.match(bad.body, /<div id="root">/)

    // The server is still alive and serving afterwards.
    const after = await fetchText(dash.url + '/assets/app.js')
    assert.equal(after.status, 200)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('a malformed escape inside a browser-proxy path serves the shell and the server survives (#938)', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle })
  try {
    // Passes the pathname guard (the URL parses), enters the proxy dispatch, and only explodes
    // at decode time inside parseBrowserRoute — the crash the round-2 pass live-repro'd.
    const bad = await fetchText(dash.url + '/browser/p/%zz/stream')
    assert.equal(bad.status, 200)
    assert.match(bad.body, /<div id="root">/)

    const after = await fetchText(dash.url + '/')
    assert.equal(after.status, 200)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('an unparseable absolute-form request target gets a 400 and the server survives (#938)', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle })
  try {
    // Node's parser passes absolute-form targets through verbatim; `new URL('http://[', ...)`
    // throws synchronously in the request handler, which unguarded kills the process.
    const raw = await rawRequest(dash.url, 'GET http://[ HTTP/1.1')
    assert.match(raw, /^HTTP\/1\.1 400 /)

    const after = await fetchText(dash.url + '/')
    assert.equal(after.status, 200)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

test('the Telefunc mount rejects a cross-origin POST (CSRF guard)', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle })
  try {
    const { status, body } = await postCrossOrigin(dash.url + '/_telefunc')
    assert.equal(status, 403)
    assert.match(body, /cross-origin/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

// The shared token (#1051): a real base64url token, matching what the registry generates.
const TOKEN = 'zX2p8Q0hqk3m9tR7vN1cW4bY6sJ5aL0dFgHiKlMnOp'

// The guard triggers on the token being configured, not on the bind host (a non-loopback bind is
// exactly what configures one). Binding loopback with the token set exercises every guard path
// without an external bind that could trip the OS firewall in an automated run; the true two-daemon
// non-loopback drive is noted as a follow-up in the PR.
async function guardedDashboard(): Promise<{ base: string; close: () => Promise<void> }> {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle, token: TOKEN })
  return {
    base: dash.url,
    close: async () => {
      await dash.close()
      await rm(bundle, { recursive: true, force: true })
    },
  }
}

test('with a token set, every route is 401 without a cookie or ?token= (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    // The static bundle, the RPC mount, and the browser proxy are all fronted uniformly.
    for (const path of ['/', '/assets/app.js', '/_telefunc', '/browser/p/x/stream']) {
      const res = await fetchAuth(base + path)
      assert.equal(res.status, 401, `${path} should be 401`)
      assert.match(res.body, /unauthorized/)
    }
  } finally {
    await close()
  }
})

test('a valid ?token= sets the HttpOnly fw_daemon cookie and 302s to the clean path (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const res = await fetchAuth(`${base}/?token=${TOKEN}`)
    assert.equal(res.status, 302)
    assert.equal(res.location, '/') // the token is stripped from the redirect target
    assert.match(res.setCookie ?? '', /^fw_daemon=/)
    assert.match(res.setCookie ?? '', /HttpOnly/)
    // Lax, not Strict, so the cookie survives the cross-origin device-hop redirect (#1052).
    assert.match(res.setCookie ?? '', /SameSite=Lax/)
    assert.match(res.setCookie ?? '', /Path=\//)
  } finally {
    await close()
  }
})

test('a wrong ?token= is 401, not admitted (timing-safe compare) (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const sameLength = await fetchAuth(`${base}/?token=${'a'.repeat(TOKEN.length)}`)
    assert.equal(sameLength.status, 401)
    const shorter = await fetchAuth(`${base}/?token=nope`)
    assert.equal(shorter.status, 401)
  } finally {
    await close()
  }
})

test('the fw_daemon cookie admits the bundle, /_telefunc, and /browser (#1051)', async () => {
  const { base, close } = await guardedDashboard()
  try {
    const cookie = `fw_daemon=${TOKEN}`
    const root = await fetchAuth(`${base}/`, cookie)
    assert.equal(root.status, 200)
    assert.match(root.body, /<div id="root">/)
    // Not 401 is the guard passing; the mount / proxy then answer on their own terms.
    const rpc = await fetchAuth(`${base}/_telefunc`, cookie)
    assert.notEqual(rpc.status, 401)
    const browser = await fetchAuth(`${base}/browser/p/x/stream`, cookie)
    assert.notEqual(browser.status, 401)
  } finally {
    await close()
  }
})

test('a loopback bind sets no token, so the gate is a no-op (byte-identical) (#1051)', async () => {
  const bundle = await fakeBundle()
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle }) // no token
  try {
    const res = await fetchAuth(dash.url + '/') // no cookie, no ?token=
    assert.equal(res.status, 200)
    assert.match(res.body, /<div id="root">/)
  } finally {
    await dash.close()
    await rm(bundle, { recursive: true, force: true })
  }
})

// A POST with an optional Cookie header, returning the status + body.
function postAuth(url: string, body: string, cookie?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', rejectPromise)
    req.end(body)
  })
}

// GET a newline-delimited event stream, collecting the first `count` lines then tearing the
// socket down (the endpoint follows forever, so it never ends on its own).
function readNdjson(url: string, cookie: string, count: number): Promise<{ status: number; lines: unknown[] }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = get(url, { headers: { cookie } }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        resolvePromise({ status: res.statusCode ?? 0, lines: [] })
        return
      }
      let buffer = ''
      const lines: unknown[] = []
      res.on('data', c => {
        buffer += c
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim()
          if (line) lines.push(JSON.parse(line))
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
        }
        if (lines.length >= count) {
          req.destroy()
          resolvePromise({ status: 200, lines })
        }
      })
      res.on('end', () => resolvePromise({ status: 200, lines }))
    })
    req.on('error', () => {}) // destroy() rejects the request; the lines are already resolved
    setTimeout(() => {
      req.destroy()
      rejectPromise(new Error('timed out reading ndjson'))
    }, 4000).unref?.()
  })
}

// A guarded dashboard wired for the device relay (#1067): a stub start that records its calls, and
// an events tail backed by a fixed list. Mirrors what the daemon wires, minus a real spawn.
async function relayDashboard(): Promise<{
  base: string
  starts: Array<{ prompt: string; kind: StartRunKind; options: StartRunOptions; projectId?: string }>
  close: () => Promise<void>
}> {
  const bundle = await fakeBundle()
  const starts: Array<{ prompt: string; kind: StartRunKind; options: StartRunOptions; projectId?: string }> = []
  const onStart = (prompt: string, kind: StartRunKind, options: StartRunOptions, projectId?: string): StartRunResult => {
    starts.push({ prompt, kind, options, ...(projectId ? { projectId } : {}) })
    return { ok: true, runId: 'srv-run' }
  }
  const events: FrameworkEvent[] = [
    { kind: 'log', message: 'e1' } as FrameworkEvent,
    { kind: 'log', message: 'e2' } as FrameworkEvent,
  ]
  const tailEvents = (_runId: string, onEvent: (event: FrameworkEvent) => void): (() => void) => {
    for (const e of events) onEvent(e)
    return () => {}
  }
  const dash = await startDashboard({ port: 0, clientBundleDir: bundle, token: TOKEN, onStart, relay: { tailEvents } })
  return {
    base: dash.url,
    starts,
    close: async () => {
      await dash.close()
      await rm(bundle, { recursive: true, force: true })
    },
  }
}

test('/_relay/start needs the cookie: 401 without it, starts the run with it (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'do it', kind: 'build', options: { autopilot: true } })
    const unauth = await postAuth(`${base}/_relay/start`, body)
    assert.equal(unauth.status, 401) // the #1051 guard fronts the relay too
    assert.equal(starts.length, 0)

    const ok = await postAuth(`${base}/_relay/start`, body, `fw_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.deepEqual(JSON.parse(ok.body), { ok: true, runId: 'srv-run' })
    assert.equal(starts.length, 1)
    assert.equal(starts[0]!.prompt, 'do it')
    assert.equal(starts[0]!.projectId, undefined) // slice 1 runs in the device's own home checkout
  } finally {
    await close()
  }
})

test('/_relay/start strips a nested remote target so a relayed run never relays onward (#1067)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const body = JSON.stringify({ prompt: 'x', kind: 'build', options: { remote: { url: 'http://evil', token: 'z' }, autopilot: true } })
    const ok = await postAuth(`${base}/_relay/start`, body, `fw_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.equal(starts[0]!.options.remote, undefined) // the onward target was dropped
    assert.equal(starts[0]!.options.autopilot, true) // the rest of the options survive
  } finally {
    await close()
  }
})

test('/_relay/events needs the cookie and streams the run\'s events as ndjson (#1067)', async () => {
  const { base, close } = await relayDashboard()
  try {
    const unauth = await fetchAuth(`${base}/_relay/events?run=srv-run`)
    assert.equal(unauth.status, 401)

    const streamed = await readNdjson(`${base}/_relay/events?run=srv-run`, `fw_daemon=${TOKEN}`, 2)
    assert.equal(streamed.status, 200)
    assert.deepEqual(streamed.lines.map(l => (l as { message?: string }).message), ['e1', 'e2'])
  } finally {
    await close()
  }
})

test('/_relay/ping is 401 without the cookie, 200 with it, and starts nothing (#1072)', async () => {
  const { base, starts, close } = await relayDashboard()
  try {
    const unauth = await fetchAuth(`${base}/_relay/ping`)
    assert.equal(unauth.status, 401) // the #1051 guard fronts the ping too

    const ok = await fetchAuth(`${base}/_relay/ping`, `fw_daemon=${TOKEN}`)
    assert.equal(ok.status, 200)
    assert.equal(ok.body, '') // an empty body: it only proves reachability
    assert.equal(starts.length, 0) // a health check must never spawn a run
  } finally {
    await close()
  }
})

test('isSameOriginRequest: absent Origin passes; same host + loopback pass; evil.com fails', () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as IncomingMessage)
  assert.equal(isSameOriginRequest(req({})), true) // no Origin (curl / tests)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://localhost:4200' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://127.0.0.1:9999' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://[::1]' })), true)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://evil.com' })), false)
  assert.equal(isSameOriginRequest(req({ origin: 'not-a-url' })), false)
})
