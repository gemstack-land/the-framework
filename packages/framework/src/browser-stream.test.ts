import assert from 'node:assert/strict'
import test from 'node:test'
import {
  framePart,
  inputToCdp,
  pickActivePage,
  startBrowserStream,
  type CdpCall,
  type CdpPageTarget,
  type CdpSession,
} from './browser-stream.js'

const page = (over: Partial<CdpPageTarget> = {}): CdpPageTarget => ({
  id: 'p1',
  type: 'page',
  url: 'https://example.com/',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/p1',
  ...over,
})

test('pickActivePage takes the agent’s current tab, not the first one it ever opened (#802)', () => {
  // Chrome lists most-recently-used first, so a newly opened tab comes first.
  const targets = [page({ id: 'new', url: 'https://login.test/' }), page({ id: 'old' })]
  assert.equal(pickActivePage(targets)?.id, 'new')
})

test('pickActivePage skips non-page targets and tabs with no socket', () => {
  const targets = [
    page({ id: 'sw', type: 'service_worker' }),
    { id: 'dead', type: 'page', url: 'about:blank' } as CdpPageTarget,
    page({ id: 'real' }),
  ]
  assert.equal(pickActivePage(targets)?.id, 'real')
})

test('pickActivePage returns nothing when the browser has no page', () => {
  assert.equal(pickActivePage([]), undefined)
})

test('a click is a press and a release — Chrome ignores a lone press', () => {
  const calls = inputToCdp({ type: 'click', x: 10, y: 20 })
  assert.deepEqual(calls.map(c => c.params.type), ['mousePressed', 'mouseReleased'])
  assert.equal(calls[0]?.params.x, 10)
})

test('typing goes through insertText so it types the character, not a key code', () => {
  assert.deepEqual(inputToCdp({ type: 'key', text: 'hüne' }), [
    { method: 'Input.insertText', params: { text: 'hüne' } },
  ])
})

test('a malformed input reaches Chrome as nothing at all', () => {
  assert.deepEqual(inputToCdp({ type: 'click', x: Number.NaN, y: 1 }), [])
  assert.deepEqual(inputToCdp({ type: 'key', text: '' }), [])
  assert.deepEqual(inputToCdp({ type: 'bogus' } as never), [])
})

test('navigate only accepts http(s) — not javascript: or file:', () => {
  assert.equal(inputToCdp({ type: 'navigate', url: 'https://ok.test/' }).length, 1)
  assert.deepEqual(inputToCdp({ type: 'navigate', url: 'javascript:alert(1)' }), [])
  assert.deepEqual(inputToCdp({ type: 'navigate', url: 'file:///etc/passwd' }), [])
})

test('framePart wraps a frame with the length the multipart reader needs', () => {
  const part = framePart('frame', Buffer.from([0xff, 0xd8, 0xff]))
  const text = part.toString('latin1')
  assert.ok(text.startsWith('--frame\r\nContent-Type: image/jpeg\r\n'))
  assert.ok(text.includes('Content-Length: 3'))
  assert.ok(text.endsWith('\r\n'))
})

/** A stand-in for Chrome: records what was sent and lets a test push a frame. */
function fakeCdp() {
  const sent: CdpCall[] = []
  let onFrame: ((p: { data: string; sessionId: number }) => void) | undefined
  const session: CdpSession = {
    send: async (method, params = {}) => {
      sent.push({ method, params })
      return {}
    },
    on: (_event, handler) => {
      onFrame = handler
    },
    close: () => {},
  }
  return { session, sent, frame: (data: string) => onFrame?.({ data, sessionId: 1 }) }
}

test('the stream starts a screencast and serves it as MJPEG', async () => {
  const cdp = fakeCdp()
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => cdp.session,
    listTargets: async () => [page()],
  })
  assert.ok(stream, 'a browser with a page yields a stream')
  try {
    assert.ok(cdp.sent.some(c => c.method === 'Page.startScreencast'))

    cdp.frame(Buffer.from([1, 2, 3]).toString('base64'))
    const res = await fetch(`${stream.url}/stream`)
    assert.equal(res.headers.get('content-type'), 'multipart/x-mixed-replace; boundary=frame')

    // The frame that arrived before anyone looked is still delivered — a pane opened on a
    // still page must not sit blank.
    const reader = res.body?.getReader()
    const first = await reader?.read()
    assert.ok((first?.value?.length ?? 0) > 0, 'the last known frame is sent on connect')
    await reader?.cancel()
  } finally {
    await stream?.close()
  }
})

test('a posted click reaches Chrome; junk is rejected without reaching it', async () => {
  const cdp = fakeCdp()
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => cdp.session,
    listTargets: async () => [page()],
  })
  assert.ok(stream)
  try {
    const ok = await fetch(`${stream.url}/input`, { method: 'POST', body: JSON.stringify({ type: 'click', x: 5, y: 6 }) })
    assert.equal(ok.status, 204)
    assert.ok(cdp.sent.some(c => c.method === 'Input.dispatchMouseEvent'))

    const before = cdp.sent.length
    const bad = await fetch(`${stream.url}/input`, { method: 'POST', body: 'not json' })
    assert.equal(bad.status, 400)
    assert.equal(cdp.sent.length, before, 'a malformed body dispatches nothing')
  } finally {
    await stream?.close()
  }
})

test('the stream binds to loopback only — these frames can show a password being typed', async () => {
  const cdp = fakeCdp()
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => cdp.session,
    listTargets: async () => [page()],
  })
  try {
    assert.ok(stream?.url.startsWith('http://127.0.0.1:'), stream?.url)
  } finally {
    await stream?.close()
  }
})

test('no page to stream means no pane, not a failed run', async () => {
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => fakeCdp().session,
    listTargets: async () => [],
  })
  assert.equal(stream, undefined)
})

test('a browser that cannot be listed is survivable', async () => {
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:1',
    connect: async () => fakeCdp().session,
    listTargets: async () => {
      throw new Error('connection refused')
    },
  })
  assert.equal(stream, undefined)
})

test('the stream follows the agent when it opens another tab (#802)', async () => {
  const sessions: ReturnType<typeof fakeCdp>[] = []
  let targets = [page({ id: 'first', url: 'https://first.test/' })]
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => {
      const cdp = fakeCdp()
      sessions.push(cdp)
      return cdp.session
    },
    listTargets: async () => targets,
    followIntervalMs: 20,
  })
  assert.ok(stream)
  try {
    assert.equal(sessions.length, 1, 'attached to the page the agent was on')

    // The agent opens a tab; Chrome now lists it first.
    targets = [page({ id: 'second', url: 'https://login.test/' }), ...targets]
    await new Promise(r => setTimeout(r, 120))

    assert.equal(sessions.length, 2, 'the pane re-attached instead of going blind')
    assert.ok(sessions[1]?.sent.some(c => c.method === 'Page.startScreencast'))
    assert.ok(sessions[0]?.sent.some(c => c.method === 'Page.stopScreencast'), 'the old tab stops streaming')
  } finally {
    await stream?.close()
  }
})

test('following survives a browser that stops answering', async () => {
  const cdp = fakeCdp()
  let fail = false
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => cdp.session,
    listTargets: async () => {
      if (fail) throw new Error('browser went away')
      return [page()]
    },
    followIntervalMs: 20,
  })
  assert.ok(stream)
  try {
    fail = true
    await new Promise(r => setTimeout(r, 80))
    const res = await fetch(`${stream.url}/stream`)
    assert.equal(res.status, 200, 'the pane keeps serving the page it already had')
    await res.body?.cancel()
  } finally {
    await stream?.close()
  }
})

test('close stops the screencast and frees the port', async () => {
  const cdp = fakeCdp()
  const stream = await startBrowserStream({
    browserUrl: 'http://127.0.0.1:9333',
    connect: async () => cdp.session,
    listTargets: async () => [page()],
  })
  assert.ok(stream)
  await stream.close()
  await stream.close() // idempotent
  assert.ok(cdp.sent.some(c => c.method === 'Page.stopScreencast'))
  await assert.rejects(fetch(`${stream.url}/stream`), 'the port is closed')
})
