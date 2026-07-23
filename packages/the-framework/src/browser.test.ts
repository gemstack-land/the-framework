import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromeLaunchArgs, freePort, launchSharedBrowser, resolveChromePath, waitForDebugEndpoint } from './browser.js'
import { browserMcpServers, withBrowser, BROWSER_MCP_SERVERS } from './browser.js'

test('chromeLaunchArgs opens the debug port on a throwaway profile (#793)', () => {
  const args = chromeLaunchArgs(9333, '/tmp/profile')
  assert.ok(args.includes('--remote-debugging-port=9333'), 'the port is what a second client attaches to')
  assert.ok(args.includes('--user-data-dir=/tmp/profile'), 'never the user’s real Chrome profile')
  assert.ok(args.includes('--headless=new'))
  assert.equal(args.at(-1), 'about:blank')
})

test('chromeLaunchArgs can run headful for local debugging', () => {
  assert.ok(!chromeLaunchArgs(1, '/tmp/p', false).includes('--headless=new'))
})

/**
 * A filesystem where only `present` exists. Injected so these assertions mean the same thing
 * on a laptop and on CI — the runners have Chrome at a well-known path, so a test that assumes
 * "nothing is installed" is really testing the host.
 */
const fsWith = (...present: string[]) => (path: string) => present.includes(path)

test('resolveChromePath prefers an explicit CHROME_PATH over the well-known locations', () => {
  const exists = fsWith('/custom/my-chrome', '/usr/bin/google-chrome')
  assert.equal(resolveChromePath({ CHROME_PATH: '/custom/my-chrome' }, 'linux', exists), '/custom/my-chrome')
  assert.equal(resolveChromePath({ PUPPETEER_EXECUTABLE_PATH: '/custom/my-chrome' }, 'linux', exists), '/custom/my-chrome')
})

test('resolveChromePath falls through an override that does not exist', () => {
  assert.equal(resolveChromePath({ CHROME_PATH: '/nope/chrome', PATH: '' }, 'linux', fsWith()), undefined)
  assert.equal(
    resolveChromePath({ CHROME_PATH: '/nope/chrome', PATH: '' }, 'linux', fsWith('/usr/bin/chromium')),
    '/usr/bin/chromium',
    'a bad override must not hide a browser that is actually installed',
  )
})

test('resolveChromePath finds a browser on PATH when no standard install exists', () => {
  assert.equal(resolveChromePath({ PATH: '/opt/bin' }, 'linux', fsWith('/opt/bin/chromium')), '/opt/bin/chromium')
})

// No Windows PATH-lookup test on purpose: `join` and `delimiter` follow the host, so asserting
// a `C:\...` result only passes when the test itself runs on Windows.

test('freePort returns a port nothing is listening on', async () => {
  const port = await freePort()
  assert.ok(port > 0 && port < 65536)
})

test('waitForDebugEndpoint resolves once the endpoint answers', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ Browser: 'Chrome/150' }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    assert.equal(await waitForDebugEndpoint(`http://127.0.0.1:${port}`, { timeoutMs: 3000 }), true)
  } finally {
    server.close()
  }
})

test('waitForDebugEndpoint gives up rather than hanging the run when Chrome never listens', async () => {
  const port = await freePort()
  assert.equal(await waitForDebugEndpoint(`http://127.0.0.1:${port}`, { timeoutMs: 250, intervalMs: 25 }), false)
})

test('a machine with no Chrome resolves to nothing, which is what makes --browser fall back', () => {
  assert.equal(resolveChromePath({ PATH: '/usr/bin' }, 'linux', fsWith()), undefined)
})

test('launchSharedBrowser gives up on a binary that never opens the port', async () => {
  // A path that cannot start: stands in for a Chrome that never listens. The run must get
  // undefined (and fall back) rather than a handle to a browser nothing is behind.
  const browser = await launchSharedBrowser({ chromePath: join(tmpdir(), 'definitely-not-chrome'), timeoutMs: 400 })
  assert.equal(browser, undefined, 'a browser that never listens must not be handed to the agent')
})

test('browserMcpServers points the MCP server at our Chrome when we launched one (#793)', () => {
  const args = browserMcpServers('http://127.0.0.1:9333')['chrome-devtools']?.args ?? []
  assert.ok(args.includes('--browserUrl'))
  assert.ok(args.includes('http://127.0.0.1:9333'))
})

test('browserMcpServers is the old launch-its-own spec when there is no shared browser', () => {
  assert.deepEqual(browserMcpServers(undefined), BROWSER_MCP_SERVERS)
  assert.ok(!(browserMcpServers(undefined)['chrome-devtools']?.args ?? []).includes('--browserUrl'))
})

test('withBrowser folds the browser URL through to the driver options', () => {
  const opts = withBrowser({ permissionMode: 'bypassPermissions' }, true, 'http://127.0.0.1:4242')
  assert.ok((opts.mcpServers?.['chrome-devtools']?.args ?? []).includes('http://127.0.0.1:4242'))
})

test('withBrowser stays a no-op without the flag, URL or not', () => {
  const base = { permissionMode: 'bypassPermissions' } as const
  assert.deepEqual(withBrowser(base, false, 'http://127.0.0.1:4242'), base)
})
