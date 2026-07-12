import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDashboard, isSameOriginRequest } from './server.js'
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

test('isSameOriginRequest: absent Origin passes; same host + loopback pass; evil.com fails', () => {
  const req = (headers: Record<string, string>): IncomingMessage => ({ headers } as IncomingMessage)
  assert.equal(isSameOriginRequest(req({})), true) // no Origin (curl / tests)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://localhost:4200' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://127.0.0.1:9999' })), true)
  assert.equal(isSameOriginRequest(req({ origin: 'http://[::1]' })), true)
  assert.equal(isSameOriginRequest(req({ host: 'localhost:4200', origin: 'http://evil.com' })), false)
  assert.equal(isSameOriginRequest(req({ origin: 'not-a-url' })), false)
})
