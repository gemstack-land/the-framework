import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// Run-start feedback (#403): a run is spawned detached, so between the click and
// the first event there must be a visible "starting" state, a watchdog for a run
// that never produces output, a failure banner, and a "busy" refusal. Drives the
// real client JS in jsdom, feeding the SSE handler and controlling the watchdog.

function boot(startResp: { ok: boolean; status: number; body?: unknown }) {
  const timers: Array<{ fn: () => void; ms: number } | null> = []
  let es: { onmessage: ((ev: { data: string }) => void) | null } | null = null
  const dom = new JSDOM(dashboardHtml('Test', true, true, true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      w['setInterval'] = () => 0
      w['setTimeout'] = (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length }
      w['clearTimeout'] = (id: number) => { if (id) timers[id - 1] = null }
      w['EventSource'] = class {
        onmessage: ((ev: { data: string }) => void) | null = null
        onerror: (() => void) | null = null
        constructor() { es = this }
        close() {}
      }
      w['fetch'] = (url: string, opts?: { method?: string }) => {
        const method = (opts && opts.method) || 'GET'
        if (url === 'api/start' && method === 'POST') {
          return Promise.resolve({ ok: startResp.ok, status: startResp.status, json: () => Promise.resolve(startResp.body || {}) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
    },
  })
  const doc = dom.window.document
  return {
    query: (sel: string) => doc.querySelector(sel),
    clickStart(prompt: string) {
      ;(doc.getElementById('start-prompt') as HTMLTextAreaElement).value = prompt
      ;(doc.getElementById('start-run') as unknown as { click: () => void }).click()
    },
    emit(fe: unknown) { es?.onmessage?.({ data: JSON.stringify(fe) }) },
    fireTimers(ms: number) { for (const t of timers) if (t && t.ms === ms) t.fn() },
  }
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }
const ok202 = { ok: true, status: 202 }

test('clicking Start shows a "starting" banner', async () => {
  const h = boot(ok202)
  await tick()
  h.clickStart('build a blog')
  await tick()
  const notice = h.query('#run-notice')!
  assert.equal(notice.hasAttribute('hidden'), false)
  assert.ok(notice.classList.contains('rn-starting'))
  assert.match(notice.textContent ?? '', /Starting your run/)
})

test('the first real (non-log) event clears the starting banner', async () => {
  const h = boot(ok202)
  await tick()
  h.clickStart('build a blog')
  await tick()
  // The daemon's own "run started" log must NOT clear it...
  h.emit({ kind: 'log', message: '▶ run started: build a blog' })
  assert.equal(h.query('#run-notice')!.hasAttribute('hidden'), false)
  // ...but the run's first real event does.
  h.emit({ kind: 'session', sessionId: 's1' })
  assert.equal(h.query('#run-notice')!.hasAttribute('hidden'), true)
})

test('the watchdog warns when a run produces no output', async () => {
  const h = boot(ok202)
  await tick()
  h.clickStart('build a blog')
  await tick()
  h.fireTimers(8000) // the stall watchdog
  const notice = h.query('#run-notice')!
  assert.ok(notice.classList.contains('rn-warn'))
  assert.match(notice.textContent ?? '', /No output yet/)
})

test('a real event before the watchdog cancels the warning', async () => {
  const h = boot(ok202)
  await tick()
  h.clickStart('build a blog')
  await tick()
  h.emit({ kind: 'session', sessionId: 's1' }) // a real event arrives first -> watchdog cleared
  h.fireTimers(8000)
  assert.equal(h.query('#run-notice')!.hasAttribute('hidden'), true)
})

test('a run-exit failure shows an error banner', async () => {
  const h = boot(ok202)
  await tick()
  h.clickStart('build a blog')
  await tick()
  h.emit({ kind: 'log', message: '✗ run exited with code 1' })
  const notice = h.query('#run-notice')!
  assert.ok(notice.classList.contains('rn-error'))
  assert.match(notice.textContent ?? '', /run exited with code 1/)
})

test('a 409 busy response shows a "run already active" banner', async () => {
  const h = boot({ ok: false, status: 409, body: { error: 'a run is already active' } })
  await tick()
  h.clickStart('build a blog')
  await tick()
  const notice = h.query('#run-notice')!
  assert.ok(notice.classList.contains('rn-busy'))
  assert.match(notice.textContent ?? '', /already active/)
})
