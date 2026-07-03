import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get } from 'node:http'
import { startDashboard } from './server.js'
import type { FrameworkEvent } from '../events.js'

function fetchText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    get(url, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }))
    }).on('error', rejectPromise)
  })
}

// Read SSE `data:` lines until `count` have arrived, then resolve and disconnect.
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
    req.on('error', () => {}) // destroy() triggers an expected error; ignore
    setTimeout(() => rejectPromise(new Error('SSE timeout')), 3000).unref?.()
  })
}

test('dashboard serves the HTML page with the title', async () => {
  const dash = await startDashboard({ port: 0, title: 'My Framework' })
  try {
    const { status, body } = await fetchText(dash.url + '/')
    assert.equal(status, 200)
    assert.match(body, /My Framework/)
    assert.match(body, /new EventSource\('\/events'\)/)
  } finally {
    await dash.close()
  }
})

test('dashboard replays buffered events and streams them over SSE', async () => {
  const dash = await startDashboard({ port: 0 })
  try {
    dash.push({ kind: 'session', driver: 'fake', workspace: '/ws', fake: true })
    dash.push({ kind: 'log', message: 'hello' })
    const events = await readSse(dash.url + '/events', 2)
    assert.equal(events[0]!.kind, 'session')
    assert.equal(events[1]!.kind, 'log')
  } finally {
    await dash.close()
  }
})

test('dashboard returns 404 for unknown paths', async () => {
  const dash = await startDashboard({ port: 0 })
  try {
    const { status } = await fetchText(dash.url + '/nope')
    assert.equal(status, 404)
  } finally {
    await dash.close()
  }
})
