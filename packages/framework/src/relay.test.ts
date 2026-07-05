import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { startRelay, relayPublisher } from './relay.js'
import type { FrameworkEvent } from './events.js'

function fetchFull(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body }))
    }).on('error', rejectPromise)
  })
}

function send(url: string, method: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method }, res => {
      let b = ''
      res.on('data', c => (b += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body: b }))
    })
    req.on('error', rejectPromise)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

// Read SSE `data:` frames until `count` have arrived, then disconnect.
function readSse(url: string, count: number): Promise<FrameworkEvent[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = get(url, res => {
      let buffer = ''
      const collected: FrameworkEvent[] = []
      res.on('data', chunk => {
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 2)
          const line = frame.split('\n').find(l => l.startsWith('data: '))
          if (line) collected.push(JSON.parse(line.slice(6)) as FrameworkEvent)
          if (collected.length >= count) {
            req.destroy()
            resolvePromise(collected)
            return
          }
        }
      })
    })
    req.on('error', rejectPromise)
  })
}

const local = { host: '127.0.0.1', port: 0 as const }

test('relay re-serves one run to two browsers, each replaying full history (#230)', async () => {
  const relay = await startRelay(local)
  try {
    relay.ingest('run-1', { kind: 'log', message: 'a' })
    relay.ingest('run-1', { kind: 'log', message: 'b' })
    relay.ingest('run-1', { kind: 'log', message: 'c' })

    // Two independent viewers connect after the fact; both replay the whole run.
    const [one, two] = await Promise.all([
      readSse(`${relay.url}/r/run-1/events`, 3),
      readSse(`${relay.url}/r/run-1/events`, 3),
    ])
    assert.deepEqual(one.map(e => (e as { message: string }).message), ['a', 'b', 'c'])
    assert.deepEqual(two.map(e => (e as { message: string }).message), ['a', 'b', 'c'])
  } finally {
    await relay.close()
  }
})

test('relayPublisher POSTs a run to the relay, which re-serves it live', async () => {
  const relay = await startRelay(local)
  try {
    // A viewer connects first; then the run publishes over HTTP.
    const seen = readSse(`${relay.url}/r/pub/events`, 2)
    const pub = relayPublisher(relay.url, 'pub')
    assert.equal(pub.url, `${relay.url}/r/pub/`)
    pub.publish({ kind: 'log', message: 'from-cli-1' })
    pub.publish({ kind: 'end', ok: true } as FrameworkEvent)
    await pub.flush()
    const events = await seen
    assert.equal((events[0] as { message: string }).message, 'from-cli-1')
    assert.equal(events[1]!.kind, 'end')
  } finally {
    await relay.close()
  }
})

test('runs are isolated by id', async () => {
  const relay = await startRelay(local)
  try {
    relay.ingest('run-a', { kind: 'log', message: 'only-a' })
    relay.ingest('run-b', { kind: 'log', message: 'only-b' })
    const a = await readSse(`${relay.url}/r/run-a/events`, 1)
    assert.deepEqual(
      a.map(e => (e as { message: string }).message),
      ['only-a'],
    )
    assert.deepEqual(relay.runIds().sort(), ['run-a', 'run-b'])
  } finally {
    await relay.close()
  }
})

test('GET /r/:id redirects to the trailing-slash page; the page loads relative SSE', async () => {
  const relay = await startRelay(local)
  try {
    const redirect = await fetchFull(`${relay.url}/r/xyz`)
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.location, '/r/xyz/')

    const page = await fetchFull(`${relay.url}/r/xyz/`)
    assert.equal(page.status, 200)
    assert.match(page.body, /new EventSource\('events'\)/) // resolves under /r/xyz/
  } finally {
    await relay.close()
  }
})

test('healthz is 200; a bad publish is rejected without crashing the run', async () => {
  const relay = await startRelay(local)
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
