import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { dashboardHtml } from './page.js'

// The Project log panel (#314) renders the committed .the-framework/LOGS.md
// entries the server returns from GET /api/logs. It drives the real client JS in
// jsdom, answering the page's own `fetch('api/logs')` with a canned payload.

interface Harness {
  query: (sel: string) => Element | null
  queryAll: (sel: string) => Element[]
  window: Record<string, unknown>
}

function boot(logs: unknown[]): Harness {
  const dom = new JSDOM(dashboardHtml('Test', true, true, true), {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      const w = window as unknown as { [k: string]: unknown }
      w['setInterval'] = () => 0
      w['setTimeout'] = () => 0
      w['EventSource'] = class {
        onmessage: ((ev: { data: string }) => void) | null = null
        onerror: (() => void) | null = null
        close() {}
      }
      w['fetch'] = (url: string) => {
        const body = url === 'api/logs' ? { logs } : { runs: [], docs: [] }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
      }
    },
  })
  const window = dom.window as unknown as { [k: string]: unknown }
  const doc = dom.window.document
  return {
    query: sel => doc.querySelector(sel),
    queryAll: sel => [...doc.querySelectorAll(sel)],
    window,
  }
}

// The page fetches on load; give the microtasks a tick to settle.
const tick = () => new Promise(resolve => setImmediate(resolve))

test('an empty log shows the empty state', async () => {
  const h = boot([])
  await tick()
  assert.match(h.query('#projectlog')!.textContent ?? '', /No runs logged yet/)
})

test('log entries render title, status, kind, and a safe session link', async () => {
  const h = boot([
    { at: '2026-07-10T10:00:00.000Z', kind: 'build', title: 'a blog', status: 'done', sessionId: 's1', sessionLink: 'https://claude.ai/code/s1' },
    { at: '2026-07-10T09:00:00.000Z', kind: 'loop', title: 'polish', status: 'stopped', prompts: ['fix header', 'tidy states'] },
  ])
  await tick()
  const items = h.queryAll('#projectlog > li')
  assert.equal(items.length, 2)
  assert.match(items[0]!.textContent ?? '', /a blog/)
  assert.match(items[0]!.textContent ?? '', /done/)
  const link = h.query('#projectlog a') as HTMLAnchorElement | null
  assert.ok(link, 'a session link renders')
  assert.equal(link!.getAttribute('href'), 'https://claude.ai/code/s1')
  // A loop's constituent prompts render as a nested list.
  assert.equal(h.queryAll('#projectlog .pl-prompts li').length, 2)
})

test('agent-controlled fields are rendered as inert text, never markup', async () => {
  const h = boot([
    {
      at: '2026-07-10T10:00:00.000Z',
      kind: 'prompt',
      title: '<img src=x onerror="window.__pwned=1">',
      status: 'done',
      sessionLink: 'javascript:alert(1)',
    },
  ])
  await tick()
  // The title survives as text, no <img> was created, and the payload never ran.
  assert.match(h.query('#projectlog .pl-title')!.textContent ?? '', /<img src=x/)
  assert.equal(h.queryAll('#projectlog img').length, 0)
  assert.equal(h.window['__pwned'], undefined)
  // The unsafe session link is neutralized to '#', not a javascript: URL.
  const link = h.query('#projectlog a') as HTMLAnchorElement | null
  assert.equal(link!.getAttribute('href'), '#')
})
