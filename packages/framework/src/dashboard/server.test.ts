import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { get, request } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function send(url: string, method: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = request(url, { method }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', rejectPromise)
    req.end()
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
    // Relative path so it resolves against the page's base URL — /events on the
    // localhost dashboard, /r/<id>/events when re-served by the relay (#230).
    assert.match(body, /new EventSource\('events'\)/)
    // The Modes panel + its renderer ship in the page (#272), hidden until a modes event.
    assert.match(body, /id="modes-panel" hidden/)
    assert.match(body, /function renderModes/)
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

test('page labels the generic default "Open Claude Code", not a live session (#214)', async () => {
  const dash = await startDashboard({ port: 0 })
  try {
    const { body } = await fetchText(dash.url + '/')
    // Honest label: the generic entry point is not a per-run live session.
    assert.match(body, /GENERIC_SESSION_LINK = "https:\/\/claude\.ai\/code"/)
    assert.match(body, /'Open Claude Code'/)
    assert.match(body, /'live session'/) // still used for a real --session-link
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

test('POST /stop invokes onStop and the page renders the Stop button (#218)', async () => {
  let stopped = 0
  const dash = await startDashboard({ port: 0, onStop: () => stopped++ })
  try {
    const { status, body } = await send(dash.url + '/stop', 'POST')
    assert.equal(status, 202)
    assert.match(body, /"ok":true/)
    assert.equal(stopped, 1)
    // The page ships the button + enables it when a stop handler is wired.
    const page = await fetchText(dash.url + '/')
    assert.match(page.body, /id="stop"/)
    assert.match(page.body, /STOPPABLE = true/)
  } finally {
    await dash.close()
  }
})

test('/api/runs lists the workspace archive and /api/runs/<id> replays a run (#303)', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'fw-hist-'))
  const runs = join(cwd, '.framework', 'runs')
  await mkdir(runs, { recursive: true })
  const events: FrameworkEvent[] = [
    { kind: 'session', driver: 'fake', workspace: cwd, fake: true },
    { kind: 'bootstrap', event: { type: 'scope', scope: 'full', intent: 'a blog' } },
    { kind: 'end', ok: true },
  ]
  const id = '2026-07-04T00-00-00-000Z'
  await writeFile(join(runs, `${id}.jsonl`), events.map(e => JSON.stringify(e)).join('\n') + '\n')
  await writeFile(
    join(runs, `${id}.json`),
    JSON.stringify({ version: 1, id, status: 'done', startedAt: '2026-07-04T00:00:00.000Z', updatedAt: '', passes: 1, intent: 'a blog' }),
  )

  const dash = await startDashboard({ port: 0, cwd })
  try {
    const list = await fetchText(dash.url + '/api/runs')
    assert.equal(list.status, 200)
    const parsed = JSON.parse(list.body) as { runs: { id: string; intent: string; status: string }[] }
    assert.equal(parsed.runs.length, 1)
    assert.equal(parsed.runs[0]!.intent, 'a blog')
    assert.equal(parsed.runs[0]!.status, 'done')

    const one = await fetchText(dash.url + '/api/runs/' + id)
    assert.equal(one.status, 200)
    const run = JSON.parse(one.body) as { id: string; events: FrameworkEvent[]; meta: { intent: string } }
    assert.equal(run.id, id)
    assert.equal(run.events.length, 3)
    assert.equal(run.meta.intent, 'a blog')

    assert.equal((await fetchText(dash.url + '/api/runs/does-not-exist')).status, 404)
  } finally {
    await dash.close()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('/api/runs is an empty list when no workspace is wired', async () => {
  const dash = await startDashboard({ port: 0 })
  try {
    const list = await fetchText(dash.url + '/api/runs')
    assert.equal(list.status, 200)
    assert.deepEqual(JSON.parse(list.body), { runs: [] })
    assert.equal((await fetchText(dash.url + '/api/runs/anything')).status, 404)
  } finally {
    await dash.close()
  }
})

test('/stop is 405 for a non-POST and 404 when stopping is not wired (#218)', async () => {
  const withStop = await startDashboard({ port: 0, onStop: () => {} })
  try {
    assert.equal((await send(withStop.url + '/stop', 'GET')).status, 405)
  } finally {
    await withStop.close()
  }
  const noStop = await startDashboard({ port: 0 })
  try {
    assert.equal((await send(noStop.url + '/stop', 'POST')).status, 404)
    const page = await fetchText(noStop.url + '/')
    assert.match(page.body, /STOPPABLE = false/)
  } finally {
    await noStop.close()
  }
})
